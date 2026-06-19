# AuditLab — AI Scientific Audit System

Audit scientific articles using 6 AI agents powered by **Typhoon2 8B** running on a Kaggle T4 GPU.

## Stack
| Layer | Technology |
|---|---|
| LLM | Typhoon2 8B (scb10x/llama3.1-typhoon2-8b-instruct) |
| Backend | FastAPI + SSE on Kaggle |
| Tunnel | ngrok |
| Frontend | Vanilla HTML/CSS/JS |
| Hosting | Netlify |

## Quick Start

### 1. Kaggle Backend
1. Open a Kaggle notebook with GPU (T4) enabled
2. Load Typhoon2 8B as `model` and `tokenizer`
3. Install deps: `pip install fastapi uvicorn pyngrok sse-starlette`
4. Paste and run `kaggle/backend_cell.py`
5. Copy the **PUBLIC URL** printed in the output

### 2. Frontend
- **Local:** `cd frontend && python -m http.server 3000` → open http://localhost:3000
- **Netlify:** push this repo → Netlify auto-deploys `frontend/` (see `netlify.toml`)

### 3. Connect
Click **⚙️** in the top-right → paste the ngrok URL → Save.

Repeat step 3 after every Kaggle session restart.

## Agents
| Agent | Weight | Checks |
|---|---|---|
| Logic | 1.0 | Fallacies, unsupported inferences |
| Citation | 1.0 | Missing refs, over-reliance |
| Statistics | 1.1 | p-values, effect sizes, methodology |
| Retrieval | 1.2 | Literature coverage, outdated refs |
| Sci. Consistency | 1.0 | Internal consistency, term definitions |
| Skeptic | 0.9 | Alternative explanations, confounders |

## Scoring
```
final = clamp(bayesian_weighted_mean + mechanism_adjustment, 0, 10)
```
Tiers: **≥7.5 LOW** · **≥5.5 MEDIUM** · **≥3.5 HIGH** · **<3.5 CRITICAL**
