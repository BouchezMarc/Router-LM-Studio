
const form = document.querySelector("#chat-form");
const input = document.querySelector("#question");
const sendButton = document.querySelector("#send");
const messages = document.querySelector("#messages");
const statusLabel = document.querySelector("#status");

function addMessage(label, content, className) {
    const article = document.createElement("article");
    article.className = `message ${className}`;

    const heading = document.createElement("div");
    heading.className = "message-label";
    heading.textContent = label;

    const body = document.createElement("div");
    body.className = "answer";
    body.textContent = content;

    article.append(heading, body);
    messages.append(article);
    article.scrollIntoView({ behavior: "smooth", block: "end" });

    return { article, body, heading };
}

function clearWelcome() {
    messages.querySelector(".welcome")?.remove();
}

async function checkHealth() {
    try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error();

        statusLabel.textContent = "API connectée";
        statusLabel.classList.add("online");
    } catch {
        statusLabel.textContent = "API indisponible";
        statusLabel.classList.remove("online");
    }
}

function addEvaluation(article, interactionId) {
    const panel = document.createElement("section");
    panel.className = "evaluation";

    const title = document.createElement("strong");
    title.textContent = "Évaluer cette interaction";
    panel.append(title);

    let routingCorrect = null;
    let answerRating = null;

    function addChoiceGroup(labelText, options, onSelect) {
        const group = document.createElement("div");
        group.className = "evaluation-group";

        const label = document.createElement("div");
        label.className = "evaluation-label";
        label.textContent = labelText;
        group.append(label);

        const buttons = [];

        for (const option of options) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "evaluation-choice";
            button.textContent = option.label;

            button.addEventListener("click", () => {
                buttons.forEach((item) => item.classList.remove("selected"));
                button.classList.add("selected");
                onSelect(option.value);
            });

            buttons.push(button);
            group.append(button);
        }

        panel.append(group);
    }

    addChoiceGroup(
        "Le modèle choisi était-il adapté ?",
        [
            { label: "Oui", value: true },
            { label: "Non", value: false }
        ],
        (value) => { routingCorrect = value; }
    );

    addChoiceGroup(
        "Qualité de la réponse",
        [
            { label: "1 — Mauvaise", value: 1 },
            { label: "2", value: 2 },
            { label: "3", value: 3 },
            { label: "4", value: 4 },
            { label: "5 — Excellente", value: 5 }
        ],
        (value) => { answerRating = value; }
    );

    const comment = document.createElement("textarea");
    comment.className = "evaluation-comment";
    comment.placeholder = "Commentaire facultatif : erreur de routage, réponse incorrecte...";
    comment.rows = 2;
    panel.append(comment);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "evaluation-save";
    saveButton.textContent = "Enregistrer l'évaluation";

    const status = document.createElement("span");
    status.className = "evaluation-status";

    saveButton.addEventListener("click", async () => {
        if (
            routingCorrect === null &&
            answerRating === null &&
            !comment.value.trim()
        ) {
            status.textContent = "Choisis une évaluation ou ajoute un commentaire.";
            return;
        }

        saveButton.disabled = true;
        status.textContent = "Enregistrement...";

        try {
            const response = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    interaction_id: interactionId,
                    routing_correct: routingCorrect,
                    answer_rating: answerRating,
                    comment: comment.value
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || "Échec de l'enregistrement.");
            }

            status.textContent = "Évaluation enregistrée.";
            panel.classList.add("evaluation-saved");
            comment.disabled = true;
            panel.querySelectorAll("button").forEach((button) => {
                button.disabled = true;
            });
        } catch (error) {
            status.textContent = error.message;
            saveButton.disabled = false;
        }
    });

    panel.append(saveButton, status);
    article.append(panel);
}



async function sendQuestion(question) {
    const questionText =
        typeof question === "string" ? question.trim() : "";

    if (!questionText || sendButton.disabled) return;

    clearWelcome();
    addMessage("Vous", questionText, "user");

    const pending = addMessage("Laya", "", "assistant");

    let finalData = null;

    sendButton.disabled = true;
    input.disabled = true;
    sendButton.textContent = "En cours...";

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                question: questionText,
            }),
        });

        // Lire le corps une seule fois.
        const raw = await response.text();
        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            throw new Error(
                `Réponse serveur non JSON (HTTP ${response.status}) : ` +
                raw.slice(0, 500)
            );
        }

        if (!response.ok) {
            const detail = data.detail;
            throw new Error(
                typeof detail === "string"
                    ? detail
                    : JSON.stringify(detail ?? data)
            );
        }

        finalData = data;

        // Réponse complète affichée en une seule fois.
        pending.heading.textContent = `Laya → ${data.choice}`;
        pending.body.textContent = data.answer ?? "";

        // Modèle et durée.
        const info = document.createElement("div");
        info.className = "model-info final-model-info";
        info.textContent =
            `Modèle : ${data.model} · Durée : ${data.latency_ms} ms`;

        pending.article.insertBefore(info, pending.body);

        // Pourcentages des trois modèles.
        addModelScores(
            pending.article,
            data.probabilities
        );

        // Satisfaction utilisateur.
        if (data.interaction_id) {
            addEvaluation(
                pending.article,
                data.interaction_id
            );
        }
    } catch (error) {
        console.error("Erreur lors de l'envoi à Laya :", error);

        pending.heading.textContent = "Erreur";
        pending.body.textContent =
            error instanceof Error
                ? error.message
                : String(error);
    } finally {
        sendButton.disabled = false;
        input.disabled = false;
        sendButton.textContent = "Envoyer ↑";
        input.focus();
    }
}



function createTimeline(article) {
    const panel = document.createElement("section");
    panel.className = "timeline";

    const title = document.createElement("div");
    title.className = "timeline-title";
    title.textContent = "Déroulement du traitement";

    const list = document.createElement("div");
    list.className = "timeline-list";

    panel.append(title, list);
    article.insertBefore(panel, article.querySelector(".answer"));

    const steps = new Map();

    function update(step) {
        let item = steps.get(step.id);

        if (!item) {
            item = document.createElement("div");
            item.className = "timeline-step";

            const indicator = document.createElement("span");
            indicator.className = "timeline-indicator";

            const details = document.createElement("div");
            details.className = "timeline-details";

            const label = document.createElement("div");
            label.className = "timeline-label";

            const meta = document.createElement("div");
            meta.className = "timeline-meta";

            details.append(label, meta);
            item.append(indicator, details);
            list.append(item);

            steps.set(step.id, { item, indicator, label, meta });
        }

        item.label.textContent = step.label;

        item.item.classList.remove(
            "is-running", "is-done", "is-error"
        );

        const status = step.status || "running";
        item.item.classList.add(`is-${status}`);

        item.indicator.textContent =
            status === "done" ? "✓" :
            status === "error" ? "!" : "…";

        if (step.duration_ms != null) {
            item.meta.textContent = `${step.duration_ms} ms`;
        } else if (status === "running") {
            item.meta.textContent = "En cours";
        } else {
            item.meta.textContent = "";
        }
    }

    return { update };
}

function addModelScores(article, probabilities) {
    article.querySelector(".model-scores")?.remove();

    const scores = document.createElement("div");
    scores.className = "model-scores";

    const labels = {
        qwen: "Qwen",
        deepseek: "DeepSeek",
        gemma: "Gemma",
    };

    for (const name of ["qwen", "deepseek", "gemma"]) {
        const probability = probabilities?.[name];
        const row = document.createElement("div");
        row.className = "score-row";

        const label = document.createElement("span");
        label.textContent = labels[name];

        const bar = document.createElement("progress");
        bar.max = 1;
        bar.value = probability == null
            ? 0
            : Math.max(0, Math.min(1, Number(probability)));

        const value = document.createElement("span");
        value.textContent = probability == null
            ? "N/D"
            : `${(Number(probability) * 100).toFixed(1)} %`;

        row.append(label, bar, value);
        scores.append(row);
    }

    article.insertBefore(scores, article.querySelector(".answer"));
}


form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    input.value = "";
    await sendQuestion(question);
});

document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
        input.value = button.dataset.question;
        input.focus();
    });
});

input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

checkHealth();