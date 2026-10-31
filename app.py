from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import sqlite3
import time
from fastapi.responses import FileResponse, StreamingResponse
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from laya import Router

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "history.db"
LM_STUDIO_URL = "http://127.0.0.1:1234/v1"

MODELS = {
    "qwen": "qwen3-14b",
    "deepseek": "deepseek-r1-distill-qwen-14b",
    "gemma": "google/gemma-4-12b-qat",
}

QUESTIONS = {
    "model": {
        "type": "choice",
        "instructions": (
            "Choisis le modèle le plus adapté à la demande : "
            "qwen pour le code, la programmation et les tâches techniques ; "
            "deepseek pour le raisonnement complexe, les calculs multiétapes "
            "et les problèmes logiques ; "
            "gemma pour les explications simples, la vulgarisation, "
            "la rédaction et les questions générales."
        ),
        "criteria": {
            "qwen": "Code, programmation et tâches techniques",
            "deepseek": (
                "Raisonnement complexe, calculs multiétapes "
                "et problèmes logiques"
            ),
            "gemma": (
                "Explications simples, vulgarisation, rédaction "
                "et questions générales"
            ),
        },
    }
}

app = FastAPI(title="Laya Model Router")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
router = Router(device="cpu", max_loaded=1)


def now_iso():
    return datetime.now(ZoneInfo("Europe/Paris")).isoformat()


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                question TEXT NOT NULL,
                choice TEXT,
                model TEXT,
                probabilities TEXT,
                confidence REAL,
                answer TEXT,
                latency_ms INTEGER,
                error TEXT,
                routing_correct INTEGER,
                answer_rating INTEGER,
                feedback_comment TEXT,
                evaluated_at TEXT
            )
        """)


def save_interaction(
    question,
    choice=None,
    model=None,
    probabilities=None,
    confidence=None,
    answer=None,
    latency_ms=None,
    error=None,
):
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO interactions (
                created_at, question, choice, model, probabilities,
                confidence, answer, latency_ms, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_iso(),
                question,
                choice,
                model,
                json.dumps(probabilities or {}, ensure_ascii=False),
                confidence,
                answer,
                latency_ms,
                error,
            ),
        )
        return cursor.lastrowid


init_db()


class ChatRequest(BaseModel):
    question: str = Field(min_length=1)


class FeedbackRequest(BaseModel):
    interaction_id: int
    routing_correct: bool | None = None
    answer_rating: int | None = Field(default=None, ge=1, le=5)
    comment: str = Field(default="", max_length=2000)


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "laya_device": "cpu"}

def sse_event(event, **data):
    """Encode un événement Server-Sent Events."""
    payload = json.dumps(
        {"event": event, **data},
        ensure_ascii=False,
    )
    return f"data: {payload}\n\n"

@app.post("/api/chat")
def chat(payload: ChatRequest):
    question = payload.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Question vide.",
        )

    started = time.perf_counter()
    choice = None
    model_id = None
    probabilities = {}
    confidence = None

    try:
        # 1. Sélection du modèle
        decision = router.decide(
            question,
            questions=QUESTIONS,
            min_confidence=0.0,
        )

        model_result = decision["model"]
        choice = model_result["choice"]
        model_id = MODELS[choice]
        probabilities = model_result.get("probabilities", {})
        confidence = model_result.get("confidence")

        # 2. Génération classique, sans streaming
        request_body = {
            "model": model_id,
            "messages": [
                {"role": "user", "content": question}
            ],
            "temperature": 0.2,
            "max_tokens": 2048,
            "stream": False,
        }

        response = requests.post(
            f"{LM_STUDIO_URL}/chat/completions",
            json=request_body,
            timeout=(10, 300),
        )
        response.raise_for_status()

        data = response.json()
        answer = data["choices"][0]["message"]["content"]

        latency_ms = int(
            (time.perf_counter() - started) * 1000
        )

        # 3. Enregistrement de l'interaction
        interaction_id = save_interaction(
            question=question,
            choice=choice,
            model=model_id,
            probabilities=probabilities,
            confidence=confidence,
            answer=answer,
            latency_ms=latency_ms,
        )

        # 4. Réponse JSON unique
        return {
            "interaction_id": interaction_id,
            "question": question,
            "choice": choice,
            "model": model_id,
            "answer": answer,
            "confidence": confidence,
            "probabilities": probabilities,
            "latency_ms": latency_ms,
        }

    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Impossible de joindre LM Studio. "
                "Vérifie que son serveur local est démarré."
            ),
        ) from exc

    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Réponse LM Studio invalide : {exc}",
        ) from exc


@app.post("/api/feedback")
def save_feedback(payload: FeedbackRequest):
    if (
        payload.routing_correct is None
        and payload.answer_rating is None
        and not payload.comment.strip()
    ):
        raise HTTPException(
            status_code=400,
            detail="Indique au moins une évaluation ou un commentaire.",
        )

    with get_db() as conn:
        cursor = conn.execute(
            """
            UPDATE interactions
            SET routing_correct = ?,
                answer_rating = ?,
                feedback_comment = ?,
                evaluated_at = ?
            WHERE id = ?
            """,
            (
                None if payload.routing_correct is None
                else int(payload.routing_correct),
                payload.answer_rating,
                payload.comment.strip(),
                now_iso(),
                payload.interaction_id,
            ),
        )

        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Interaction introuvable.",
            )

    return {"status": "saved", "interaction_id": payload.interaction_id}


@app.get("/stats")
def stats_page():
    return FileResponse(STATIC_DIR / "stats.html")


@app.get("/api/stats")
def get_stats():
    """Statistiques calculées sur les interactions réelles de history.db."""
    with get_db() as conn:
        totals = conn.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) AS errors,
                AVG(latency_ms) AS avg_latency_ms,
                SUM(CASE WHEN routing_correct IS NOT NULL THEN 1 ELSE 0 END) AS routing_evaluated,
                SUM(CASE WHEN routing_correct = 1 THEN 1 ELSE 0 END) AS routing_correct,
                SUM(CASE WHEN answer_rating IS NOT NULL THEN 1 ELSE 0 END) AS answers_rated,
                AVG(answer_rating) AS avg_answer_rating
            FROM interactions
        """).fetchone()

        models_rows = conn.execute("""
            SELECT
                COALESCE(choice, 'inconnu') AS choice,
                COALESCE(model, 'inconnu') AS model,
                COUNT(*) AS count,
                AVG(latency_ms) AS avg_latency_ms,
                SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN routing_correct IS NOT NULL THEN 1 ELSE 0 END) AS routing_evaluated,
                SUM(CASE WHEN routing_correct = 1 THEN 1 ELSE 0 END) AS routing_correct,
                COUNT(answer_rating) AS answers_rated,
                AVG(answer_rating) AS avg_answer_rating
            FROM interactions
            GROUP BY choice, model
            ORDER BY count DESC
        """).fetchall()

        daily_rows = conn.execute("""
            SELECT
                substr(created_at, 1, 10) AS day,
                COUNT(*) AS count,
                AVG(latency_ms) AS avg_latency_ms,
                SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) AS errors
            FROM interactions
            GROUP BY substr(created_at, 1, 10)
            ORDER BY day
        """).fetchall()

        recent_rows = conn.execute("""
            SELECT id, created_at, question, choice, model, probabilities,
                   confidence, answer, latency_ms, error, routing_correct,
                   answer_rating, feedback_comment, evaluated_at
            FROM interactions
            ORDER BY id DESC
            LIMIT 100
        """).fetchall()

    total = totals["total"] or 0
    errors = totals["errors"] or 0
    routing_evaluated = totals["routing_evaluated"] or 0
    routing_correct = totals["routing_correct"] or 0

    def row_dict(row):
        item = dict(row)
        if "probabilities" in item:
            try:
                item["probabilities"] = json.loads(item["probabilities"] or "{}")
            except (TypeError, json.JSONDecodeError):
                item["probabilities"] = {}
        return item

    return {
        "summary": {
            "total": total,
            "errors": errors,
            "error_rate": (errors / total * 100) if total else None,
            "avg_latency_ms": totals["avg_latency_ms"],
            "routing_evaluated": routing_evaluated,
            "routing_correct": routing_correct,
            "routing_accuracy": (
                routing_correct / routing_evaluated * 100
                if routing_evaluated else None
            ),
            "answers_rated": totals["answers_rated"] or 0,
            "avg_answer_rating": totals["avg_answer_rating"],
        },
        "models": [dict(row) for row in models_rows],
        "daily": [dict(row) for row in daily_rows],
        "interactions": [row_dict(row) for row in recent_rows],
    }
