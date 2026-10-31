
import requests
from laya import Router

BASE_URL = "http://localhost:1234/v1"

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
            "qwen pour le code et les tâches techniques, "
            "deepseek pour le raisonnement complexe, "
            "gemma pour les demandes générales et les explications simples."
        ),
        "criteria": {
            "qwen": "Code, Programmation et tâches techniques",
            "deepseek": "raisonnement complexe, calculs multiétapes et problèmes logiques",
            "gemma": "explications simples, vulgarisation, rédaction et questions générales",
        },
    }
}

router = Router(device="cpu", max_loaded=1)


def ask_lm_studio(model_id: str, question: str) -> str:
    response = requests.post(
        f"{BASE_URL}/chat/completions",
        json={
            "model": model_id,
            "messages": [{"role": "user", "content": question}],
            "temperature": 0.2,
            "max_tokens": 400,
        },
        timeout=300,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


if __name__ == "__main__":
    question = input("Ta question : ").strip()

    if not question:
        raise SystemExit("Question vide.")

    decision = router.decide(
        question,
        questions=QUESTIONS,
        min_confidence=0.0,
    )

    choice = decision["model"]["choice"]
    model_id = MODELS[choice]

    print(f"\nChoix Laya : {choice}")
    print(f"Modèle LM Studio : {model_id}")
    print("\nGénération de la réponse...\n")

    answer = ask_lm_studio(model_id, question)
    print(answer)
