const $ = (id) => document.getElementById(id);

const modelLabels = {
    qwen: "Qwen",
    deepseek: "DeepSeek",
    gemma: "Gemma",
    inconnu: "Inconnu"
};

function number(value, digits = 0) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("fr-FR", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits
    });
}

function percent(value) {
    return value === null || value === undefined ? "—" : `${number(value, 1)} %`;
}

function dateLabel(value) {
    if (!value) return "—";
    return value.replace("T", " ").slice(0, 16);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
}

function modelLabel(choice, model) {
    const name = modelLabels[choice] || choice || "Inconnu";
    return `${name}${model ? ` · ${model}` : ""}`;
}

function renderModels(models) {
    const root = $("models");
    if (!models.length) {
        root.innerHTML = '<p class="empty">Aucune interaction enregistrée pour le moment.</p>';
        return;
    }

    const total = models.reduce((sum, item) => sum + item.count, 0);
    root.innerHTML = models.map((item) => {
        const share = total ? item.count / total * 100 : 0;
        const evaluated = Number(item.routing_evaluated || 0);
        const routing = evaluated
            ? `${number(Number(item.routing_correct || 0) / evaluated * 100, 1)} % (${evaluated} évaluations)`
            : "Pas encore évalué";
        const rating = item.avg_answer_rating == null
            ? "—"
            : `${number(item.avg_answer_rating, 2)} / 5`;
        return `
            <article class="model-card">
                <div class="model-card-head">
                    <strong>${escapeHtml(modelLabels[item.choice] || item.choice)}</strong>
                    <span>${number(item.count)} · ${number(share, 1)} %</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${share}%"></div></div>
                <dl>
                    <div><dt>Latence moyenne</dt><dd>${item.avg_latency_ms == null ? "—" : `${number(item.avg_latency_ms)} ms`}</dd></div>
                    <div><dt>Erreurs</dt><dd>${number(item.errors || 0)}</dd></div>
                    <div><dt>Routage pertinent</dt><dd>${routing}</dd></div>
                    <div><dt>Note moyenne</dt><dd>${rating}</dd></div>
                </dl>
            </article>`;
    }).join("");
}

function renderDaily(days) {
    const body = $("daily-rows");
    if (!days.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty">Aucune donnée disponible.</td></tr>';
        return;
    }
    body.innerHTML = [...days].reverse().map((day) => `
        <tr>
            <td>${escapeHtml(day.day)}</td>
            <td>${number(day.count)}</td>
            <td>${day.avg_latency_ms == null ? "—" : `${number(day.avg_latency_ms)} ms`}</td>
            <td>${number(day.errors || 0)}</td>
        </tr>`).join("");
}

let allInteractions = [];

function renderHistory() {
    const query = $("filter").value.trim().toLocaleLowerCase("fr");
    const filtered = allInteractions.filter((item) => {
        const searchable = [
            item.question, item.choice, item.model, item.error, item.feedback_comment
        ].join(" ").toLocaleLowerCase("fr");
        return searchable.includes(query);
    });

    const body = $("history-rows");
    if (!filtered.length) {
        body.innerHTML = '<tr><td colspan="8" class="empty">Aucune interaction correspondante.</td></tr>';
        return;
    }

    body.innerHTML = filtered.map((item) => {
        const probs = item.probabilities || {};
        const probabilityText = Object.entries(probs)
            .map(([key, value]) => `${modelLabels[key] || key}: ${number(Number(value) * 100, 1)} %`)
            .join("<br>") || "—";
        const routing = item.routing_correct === 1
            ? '<span class="pill good">Pertinent</span>'
            : item.routing_correct === 0
                ? '<span class="pill bad">Inadapté</span>' : "—";
        const rating = item.answer_rating == null ? "—" : `${item.answer_rating} / 5`;
        const question = item.error
            ? `<span class="error-text">${escapeHtml(item.error)}</span><hr>${escapeHtml(item.question)}`
            : escapeHtml(item.question);
        return `<tr>
            <td>${escapeHtml(dateLabel(item.created_at))}</td>
            <td class="question-cell">${question}</td>
            <td>${escapeHtml(modelLabel(item.choice, item.model))}</td>
            <td class="prob-cell">${probabilityText}</td>
            <td>${item.latency_ms == null ? "—" : `${number(item.latency_ms)} ms`}</td>
            <td>${routing}</td>
            <td>${rating}</td>
            <td>${escapeHtml(item.feedback_comment || "—")}</td>
        </tr>`;
    }).join("");
}

async function loadStats() {
    $("refresh").disabled = true;
    $("updated-at").textContent = "Actualisation...";
    try {
        const response = await fetch("/api/stats", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const s = data.summary;

        $("total").textContent = number(s.total);
        $("latency").textContent = s.avg_latency_ms == null ? "—" : `${number(s.avg_latency_ms)} ms`;
        $("error-rate").textContent = percent(s.error_rate);
        $("error-count").textContent = `${number(s.errors)} erreur(s)`;
        $("routing-accuracy").textContent = percent(s.routing_accuracy);
        $("routing-count").textContent = `${number(s.routing_evaluated)} routage(s) évalué(s)`;
        $("rating").textContent = s.avg_answer_rating == null ? "—" : `${number(s.avg_answer_rating, 2)} / 5`;
        $("rating-count").textContent = `${number(s.answers_rated)} réponse(s) notée(s)`;

        renderModels(data.models || []);
        renderDaily(data.daily || []);
        allInteractions = data.interactions || [];
        renderHistory();
        $("updated-at").textContent = `Mis à jour à ${new Date().toLocaleTimeString("fr-FR")}`;
    } catch (error) {
        $("updated-at").textContent = "Erreur de chargement";
        $("models").innerHTML = `<p class="error-text">Impossible de charger les statistiques : ${escapeHtml(error.message)}</p>`;
    } finally {
        $("refresh").disabled = false;
    }
}

$("refresh").addEventListener("click", loadStats);
$("filter").addEventListener("input", renderHistory);
loadStats();
