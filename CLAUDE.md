# AuditLab — AI Scientific Audit System

## Architecture
Browser (Netlify) → ngrok tunnel → Kaggle FastAPI → Typhoon2 8B (T4 GPU)

## Project Structure
```
AI_Audit_Project/
├── CLAUDE.md
├── README.md
├── netlify.toml
├── kaggle/
│   └── backend_cell.py     ← paste as 1 cell in Kaggle after Typhoon2 loads
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js              ← API_URL is configurable via UI input (no manual edit needed)
└── docs/
    └── architecture.md
```

## Backend (Kaggle `backend_cell.py`)
- FastAPI server on port 8000
- 6 agents in sequence: Logic → Citation → Statistics → Retrieval → Sci.Consistency → Skeptic
- Bayesian weighted scoring + Mechanism Design adjustment
- Game Theory: Shapley (64 coalitions) + Debate Equilibrium + Peer Prediction
- ngrok tunnel → prints PUBLIC_URL when running
- Streaming via SSE: `POST /audit/stream`

## Agent Weights
```python
Logic: 1.0, Citation: 1.0, Statistics: 1.1,
Retrieval: 1.2, Sci.Consistency: 1.0, Skeptic: 0.9
```

## Scoring
```
final = clamp(bayesian_weighted_mean + mechanism_adjustment, 0, 10)

Adjustments:
  2+ CRITICAL → -1.5 | 1 CRITICAL → -0.8
  3+ HIGH     → -0.5
  Retrieval ≥7 → +0.3 | Retrieval ≤3 → -0.4
  Stats+Skeptic both HIGH/CRITICAL → -0.6

Tiers: ≥7.5=LOW | ≥5.5=MEDIUM | ≥3.5=HIGH | <3.5=CRITICAL
```

## Common Commands
```bash
# Preview local frontend
cd frontend && python -m http.server 3000

# Test backend health
curl https://YOUR-NGROK-URL.ngrok-free.app/health

# Deploy to Netlify
netlify deploy --prod --dir frontend
```

## Workflow Each Kaggle Session
1. Run Typhoon2 load cell
2. Run backend_cell.py cell → copy the ngrok URL printed
3. Open the Netlify app → paste ngrok URL in the API URL input field
4. Click Save → audit is live
