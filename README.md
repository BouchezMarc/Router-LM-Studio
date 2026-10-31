# Laya Model Router

Application web locale qui utilise [Laya](https://github.com/laya-ai/laya)
pour choisir automatiquement le modèle le plus adapté parmi trois LLM
chargés dans [LM Studio](https://lmstudio.ai/).

Le principe est simple :

1. une question est envoyée à l'application ;
2. Laya la classe selon son intention ;
3. l'application sélectionne le modèle correspondant ;
4. la requête est envoyée à l'API compatible OpenAI de LM Studio ;
5. la réponse, le choix du routeur et les métriques sont enregistrés dans
   `history.db`.

Les requêtes restent en local : l'application communique avec LM Studio via
`http://127.0.0.1:1234/v1`.

## Modèles utilisés

| Choix Laya | Modèle LM Studio | Usage privilégié |
| --- | --- | --- |
| `qwen` | `qwen3-14b` | Code, programmation et tâches techniques |
| `deepseek` | `deepseek-r1-distill-qwen-14b` | Raisonnement complexe, calculs multiétapes et problèmes logiques |
| `gemma` | `google/gemma-4-12b-qat` | Explications simples, vulgarisation, rédaction et questions générales |

Les identifiants doivent correspondre aux identifiants exposés par LM Studio.
Ils sont définis dans `app.py`, dans le dictionnaire `MODELS`.

## Prérequis

- Windows, macOS ou Linux ;
- Python **3.13 ou supérieur** ;
- [uv](https://docs.astral.sh/uv/) ;
- [LM Studio](https://lmstudio.ai/) avec les trois modèles téléchargés ;
- suffisamment de mémoire vive ou de mémoire GPU pour charger les modèles.

Laya exécute le routage sur CPU (`Router(device="cpu", max_loaded=1)`).
LM Studio peut, lui, utiliser le CPU ou le GPU selon sa configuration.

## Installation

Depuis la racine du projet :

```powershell
uv sync
uv pip install laya
```

Le paquet `laya` est importé par `app.py` et par les scripts de test. Il est
installé séparément car il n'est pas encore déclaré dans `pyproject.toml`.

## Configuration de LM Studio

1. Ouvrir LM Studio.
2. Télécharger les modèles suivants :
   - `qwen3-14b`
   - `deepseek-r1-distill-qwen-14b`
   - `google/gemma-4-12b-qat`
3. Démarrer le serveur local dans LM Studio.
4. Vérifier qu'il écoute sur `127.0.0.1:1234`.
5. Charger les modèles nécessaires dans LM Studio et vérifier que leur nom
   correspond aux identifiants du tableau ci-dessus.

L'application appelle l'endpoint suivant :

```text
POST http://127.0.0.1:1234/v1/chat/completions
```

## Démarrer l'application

```powershell
uv run uvicorn app:app --reload
```

Puis ouvrir <http://127.0.0.1:8000>.

Pour démarrer le serveur sans rechargement automatique :

```powershell
uv run uvicorn app:app
```

L'option `--reload` est adaptée au développement, mais pas à un déploiement
permanent.

## Utilisation

### Chat

Depuis la page d'accueil, saisir une question ou utiliser l'une des
suggestions. La réponse affiche :

- la catégorie choisie par Laya ;
- le modèle LM Studio utilisé ;
- la durée de traitement.

Chaque interaction est enregistrée dans `history.db`, créé automatiquement au
premier démarrage.

### Évaluation et statistiques

Après chaque réponse, il est possible d'indiquer :

- si le modèle sélectionné était pertinent ;
- une note de qualité de 1 à 5 ;
- un commentaire facultatif.

La page [Statistiques](http://127.0.0.1:8000/stats) présente les interactions,
la latence moyenne, le taux d'erreur, la répartition par modèle, l'activité
quotidienne et les 100 interactions les plus récentes.

## API

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Vérifie que l'API applicative répond |
| `POST` | `/api/chat` | Route une question puis génère une réponse |
| `POST` | `/api/feedback` | Enregistre l'évaluation d'une interaction |
| `GET` | `/api/stats` | Retourne les statistiques et l'historique |
| `GET` | `/stats` | Ouvre l'interface des statistiques |

Exemple d'appel au chat :

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/api/chat `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"question":"Écris une fonction Python pour trier une liste."}'
```

## Tester le routage

Pour tester Laya sans appeler LM Studio :

```powershell
uv run python scripts/test_laya.py
```

Pour tester le routage et générer une réponse avec LM Studio :

```powershell
uv run python scripts/test_routing_lmstudio.py
```

Ces scripts demandent une question dans le terminal. Le second nécessite que
le serveur LM Studio soit démarré et qu'un modèle correspondant soit
disponible.

## Structure du projet

```text
.
├── app.py                         # API FastAPI et logique de routage
├── history.db                     # Historique SQLite local
├── pyproject.toml                 # Métadonnées et dépendances Python
├── scripts/
│   ├── test_laya.py               # Test du classement Laya
│   └── test_routing_lmstudio.py   # Test complet avec LM Studio
├── src/projet_perso/              # Package Python du projet
└── static/
    ├── index.html                 # Interface de chat
    ├── stats.html                 # Interface des statistiques
    ├── app.js                     # Logique du chat et des évaluations
    └── stats.js                   # Chargement et affichage des statistiques
```

## Dépannage

### « Impossible de joindre LM Studio »

- vérifier que le serveur local de LM Studio est démarré ;
- vérifier l'adresse `127.0.0.1:1234` ;
- vérifier que le modèle sélectionné par Laya est disponible ;
- comparer le nom du modèle dans LM Studio avec le dictionnaire `MODELS`
  de `app.py`.

### L'import `laya` échoue

Réinstaller le paquet dans l'environnement géré par uv :

```powershell
uv pip install laya
```

### Le port 8000 est déjà utilisé

Démarrer l'application sur un autre port :

```powershell
uv run uvicorn app:app --reload --port 8001
```

## Limites actuelles

- l'adresse de LM Studio est actuellement codée en dur dans `app.py` ;
- le choix de modèle est réalisé pour chaque question, sans conversation
  persistante ;
- les réponses sont générées sans streaming ;
- le fichier SQLite est local et n'est pas destiné à un usage multi-utilisateur
  ou concurrent à grande échelle.
