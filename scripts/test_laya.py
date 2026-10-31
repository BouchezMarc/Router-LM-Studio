
from laya import Router

router = Router(device="cpu", max_loaded=1)

questions = {
    "model": {
        "type": "choice",
        "instructions": (
            "Choisis le modèle le plus adapté à la demande : "
            "qwen pour le code et les tâches techniques, "
            "deepseek pour le raisonnement complexe, "
            "gemma pour les demandes générales."
        ),
        "criteria": {
            "qwen": "Programmation, débogage, tâches techniques",
            "deepseek": "Raisonnement complexe, problèmes à plusieurs étapes",
            "gemma": "Questions générales, rédaction, explications simples",
        },
    }
}

tests = [
    "Écris une fonction Python pour trier une liste.",
    "Analyse ce problème logique en plusieurs étapes.",
    "Explique simplement le fonctionnement du système solaire.",
]

for question in tests:
    print(f"\nQuestion : {question}")

    result = router.decide(
        question,
        questions=questions,
        min_confidence=0.0,
    )

    print("Décision Laya :", result)
