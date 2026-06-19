# Architecture

## Data Flow
```
User (Browser)
  └─ POST /audit/stream ──► ngrok tunnel
                               └─► Kaggle FastAPI (port 8000)
                                     └─► Typhoon2 8B (T4 GPU)
                                           └─► 6 agents run sequentially
                                     └─► SSE stream back to browser
```

## Streaming Protocol
Events sent over SSE, each line: `data: <JSON>\n\n`

| Event | Payload |
|---|---|
| `agent_start` | `{event, agent, name}` |
| `agent_done` | `{event, agent, result: {score, issues[]}}` |
| `final` | `{event, final_score, tier, bayesian_weighted_mean, mechanism_adjustment, shapley, debate, peer_prediction, agent_scores}` |

## Game Theory
- **Shapley**: exact computation over 2⁶=64 coalitions, measures each agent's marginal contribution
- **Debate Equilibrium**: attack_surface_ratio = (HIGH+CRITICAL issues) / total issues → STABLE / CONTESTED / UNSTABLE
- **Peer Prediction (BTS)**: calibration score = how close each agent's score is to the mean of others

## Scoring Formula
```python
bwm  = sum(score[a] * weight[a] for a in agents) / sum(weight[a] for a in agents)
adj  = 0
adj -= 1.5 if critical >= 2 else (0.8 if critical == 1 else 0)
adj -= 0.5 if high >= 3 else 0
adj += 0.3 if retrieval_score >= 7 else (-0.4 if retrieval_score <= 3 else 0)
adj -= 0.6 if stats_sev in (HIGH,CRITICAL) and skeptic_sev in (HIGH,CRITICAL) else 0
final = clamp(bwm + adj, 0, 10)
```
