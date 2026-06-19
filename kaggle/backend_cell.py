"""
AuditLab Backend — paste this entire cell into Kaggle after Typhoon2 8B is loaded.
Requires: pip install fastapi uvicorn sse-starlette transformers torch

Tunnel: uses cloudflared (no account needed).
Install once in a prior cell:
  !wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
       -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
"""

import asyncio
import json
import math
import re
import subprocess
import threading
import time
from itertools import combinations
from typing import AsyncGenerator

import torch
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from transformers import AutoModelForCausalLM, AutoTokenizer

# ── Model loading ──────────────────────────────────────────────────────────────
MODEL_ID = "scb10x/llama3.1-typhoon2-8b-instruct"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_g = globals()
if isinstance(_g.get("tokenizer"), AutoTokenizer) and _g.get("model") is not None:
    tokenizer = _g["tokenizer"]
    model     = _g["model"]
    print("Using model already loaded in memory.")
else:
    print(f"Loading {MODEL_ID} on {DEVICE} ...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, torch_dtype=torch.float16, device_map="auto"
    )
    print("Model loaded.")

# ── Agent configuration ────────────────────────────────────────────────────────

AGENTS = [
    {"id": "logic",       "name": "Logic Agent",              "weight": 1.0},
    {"id": "citation",    "name": "Citation Agent",           "weight": 1.0},
    {"id": "statistics",  "name": "Statistics Agent",         "weight": 1.1},
    {"id": "retrieval",   "name": "Retrieval Agent",          "weight": 1.2},
    {"id": "consistency", "name": "Sci. Consistency Agent",   "weight": 1.0},
    {"id": "skeptic",     "name": "Skeptic Agent",            "weight": 0.9},
]

AGENT_PROMPTS = {
    "logic": (
        "You are a Logic Auditor. Analyse the logical structure of the scientific text below. "
        "Identify any logical fallacies, unsupported inferences, or circular reasoning. "
        "For each issue found, quote the exact sentence, explain the problem, and suggest a correction. "
        "Rate overall logical quality 0-10. Respond in JSON:\n"
        '{"score": <0-10>, "issues": [{"severity": "LOW|MEDIUM|HIGH|CRITICAL", '
        '"sentence": "...", "problem": "...", "correction": "..."}]}'
    ),
    "citation": (
        "You are a Citation Auditor. Review the citation practices in the text below. "
        "Flag missing citations for key claims, suspicious references, or over-reliance on a single source. "
        "Rate citation quality 0-10. Respond in JSON:\n"
        '{"score": <0-10>, "issues": [{"severity": "LOW|MEDIUM|HIGH|CRITICAL", '
        '"sentence": "...", "problem": "...", "correction": "..."}]}'
    ),
    "statistics": (
        "You are a Statistics Auditor. Examine all statistical claims, p-values, effect sizes, "
        "confidence intervals, and methodology. Flag misuse of statistics, underpowered studies, "
        "or misleading figures. Rate statistical rigor 0-10. Respond in JSON:\n"
        '{"score": <0-10>, "issues": [{"severity": "LOW|MEDIUM|HIGH|CRITICAL", '
        '"sentence": "...", "problem": "...", "correction": "..."}]}'
    ),
    "retrieval": (
        "You are a Knowledge Retrieval Auditor. Assess how well the text situates itself in existing "
        "literature. Identify missing foundational references, outdated citations, or contradictions "
        "with established findings. Rate retrieval quality 0-10. Respond in JSON:\n"
        '{"score": <0-10>, "issues": [{"severity": "LOW|MEDIUM|HIGH|CRITICAL", '
        '"sentence": "...", "problem": "...", "correction": "..."}]}'
    ),
    "consistency": (
        "You are a Scientific Consistency Auditor. Check internal consistency: do conclusions follow "
        "from results? Are terms defined consistently? Do figures match text? "
        "Rate consistency 0-10. Respond in JSON:\n"
        '{"score": <0-10>, "issues": [{"severity": "LOW|MEDIUM|HIGH|CRITICAL", '
        '"sentence": "...", "problem": "...", "correction": "..."}]}'
    ),
    "skeptic": (
        "You are a Scientific Skeptic. Challenge every major claim in the text. "
        "What could go wrong? What alternative explanations exist? What confounders are ignored? "
        "Rate overall credibility 0-10. Respond in JSON:\n"
        '{"score": <0-10>, "issues": [{"severity": "LOW|MEDIUM|HIGH|CRITICAL", '
        '"sentence": "...", "problem": "...", "correction": "..."}]}'
    ),
}

# ── LLM call ──────────────────────────────────────────────────────────────────

def call_llm(system_prompt: str, user_text: str, max_new_tokens: int = 1024) -> str:
    global tokenizer, model
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_text[:4000]},  # safety truncation
    ]
    ids = tokenizer.apply_chat_template(messages, return_tensors="pt", add_generation_prompt=True)
    ids = ids.to(DEVICE)
    with torch.no_grad():
        out = model.generate(ids, max_new_tokens=max_new_tokens, do_sample=False)
    decoded = tokenizer.decode(out[0][ids.shape[-1]:], skip_special_tokens=True)
    return decoded.strip()


def parse_agent_response(raw: str) -> dict:
    """Extract JSON from model output, falling back to a safe default."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {"score": 5.0, "issues": []}

# ── Scoring & game theory ──────────────────────────────────────────────────────

def bayesian_weighted_mean(scores: dict[str, float]) -> float:
    total_w = sum(a["weight"] for a in AGENTS)
    weighted = sum(scores[a["id"]] * a["weight"] for a in AGENTS)
    return weighted / total_w


def mechanism_adjustment(results: dict) -> float:
    adj = 0.0
    critical_count = sum(
        1 for r in results.values()
        for issue in r.get("issues", [])
        if issue.get("severity") == "CRITICAL"
    )
    high_count = sum(
        1 for r in results.values()
        for issue in r.get("issues", [])
        if issue.get("severity") == "HIGH"
    )

    if critical_count >= 2:
        adj -= 1.5
    elif critical_count == 1:
        adj -= 0.8

    if high_count >= 3:
        adj -= 0.5

    retrieval_score = results.get("retrieval", {}).get("score", 5)
    if retrieval_score >= 7:
        adj += 0.3
    elif retrieval_score <= 3:
        adj -= 0.4

    stats_sev = max((i.get("severity", "LOW") for i in results.get("statistics", {}).get("issues", [])), default="LOW")
    skep_sev  = max((i.get("severity", "LOW") for i in results.get("skeptic",    {}).get("issues", [])), default="LOW")
    if stats_sev in ("HIGH", "CRITICAL") and skep_sev in ("HIGH", "CRITICAL"):
        adj -= 0.6

    return adj


def shapley_values(scores: dict[str, float]) -> dict[str, float]:
    """Exact Shapley over 6 agents (2^6 = 64 coalitions)."""
    agent_ids = [a["id"] for a in AGENTS]
    n = len(agent_ids)
    shapley: dict[str, float] = {aid: 0.0 for aid in agent_ids}

    def coalition_value(coalition: list[str]) -> float:
        if not coalition:
            return 0.0
        return sum(scores[aid] for aid in coalition) / len(coalition)

    for i, aid in enumerate(agent_ids):
        for size in range(n):
            others = [a for a in agent_ids if a != aid]
            for subset in combinations(others, size):
                s = list(subset)
                weight = math.factorial(size) * math.factorial(n - size - 1) / math.factorial(n)
                shapley[aid] += weight * (coalition_value(s + [aid]) - coalition_value(s))

    return shapley


def debate_analysis(results: dict) -> dict:
    """Simple debate equilibrium: attack surface = fraction of issues that are HIGH/CRITICAL."""
    total, attacks = 0, 0
    for r in results.values():
        for issue in r.get("issues", []):
            total += 1
            if issue.get("severity") in ("HIGH", "CRITICAL"):
                attacks += 1
    ratio = attacks / total if total else 0
    if ratio < 0.2:
        equilibrium = "STABLE"
    elif ratio < 0.5:
        equilibrium = "CONTESTED"
    else:
        equilibrium = "UNSTABLE"
    return {"attack_surface_ratio": round(ratio, 3), "equilibrium": equilibrium, "total_issues": total}


def peer_prediction(results: dict) -> dict[str, float]:
    """Bayesian Truth Serum: calibration score per agent vs. mean of others."""
    scores = {a["id"]: results[a["id"]].get("score", 5.0) for a in AGENTS}
    calibration = {}
    for aid in scores:
        others_mean = sum(v for k, v in scores.items() if k != aid) / (len(scores) - 1)
        # Higher calibration when agent is close to consensus
        calibration[aid] = round(max(0, 1 - abs(scores[aid] - others_mean) / 10), 3)
    return calibration


def score_tier(score: float) -> str:
    if score >= 7.5:
        return "LOW"
    if score >= 5.5:
        return "MEDIUM"
    if score >= 3.5:
        return "HIGH"
    return "CRITICAL"

# ── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI(title="AuditLab API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "device": DEVICE}


async def audit_generator(text: str) -> AsyncGenerator[str, None]:
    results: dict[str, dict] = {}
    scores:  dict[str, float] = {}

    for agent in AGENTS:
        aid = agent["id"]
        yield json.dumps({"event": "agent_start", "agent": aid, "name": agent["name"]})
        await asyncio.sleep(0)

        raw = await asyncio.to_thread(call_llm, AGENT_PROMPTS[aid], text)
        parsed = parse_agent_response(raw)
        parsed["score"] = float(parsed.get("score", 5.0))
        results[aid] = parsed
        scores[aid]  = parsed["score"]

        yield json.dumps({"event": "agent_done", "agent": aid, "result": parsed})
        await asyncio.sleep(0)

    # Final scoring
    bwm   = bayesian_weighted_mean(scores)
    madj  = mechanism_adjustment(results)
    final = max(0.0, min(10.0, bwm + madj))
    shap  = shapley_values(scores)
    debate = debate_analysis(results)
    peer   = peer_prediction(results)

    yield json.dumps({
        "event": "final",
        "bayesian_weighted_mean": round(bwm, 2),
        "mechanism_adjustment":   round(madj, 2),
        "final_score":            round(final, 2),
        "tier":                   score_tier(final),
        "shapley":                {k: round(v, 4) for k, v in shap.items()},
        "debate":                 debate,
        "peer_prediction":        peer,
        "agent_scores":           {k: round(v, 2) for k, v in scores.items()},
    })


@app.post("/audit/stream")
async def audit_stream(request: Request):
    body = await request.json()
    text = body.get("text", "")

    async def generator():
        async for chunk in audit_generator(text):
            yield {"data": chunk}

    return EventSourceResponse(generator())


# ── Start server + cloudflared tunnel ─────────────────────────────────────────

def start_tunnel():
    """Launch cloudflared and print the public URL (no account required)."""
    proc = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", "http://localhost:8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    url_pattern = re.compile(r"https://[a-z0-9\-]+\.trycloudflare\.com")
    for line in proc.stdout:
        match = url_pattern.search(line)
        if match:
            public_url = match.group(0)
            print(f"\n{'='*60}")
            print(f"  PUBLIC URL: {public_url}")
            print(f"  Copy this URL into the AuditLab frontend (⚙️ button)")
            print(f"{'='*60}\n")
            break


def free_port(port: int):
    """Kill any process currently listening on the given port."""
    try:
        result = subprocess.run(
            ["fuser", "-k", f"{port}/tcp"], capture_output=True
        )
    except FileNotFoundError:
        # fuser not available — try lsof fallback
        r = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        pids = r.stdout.strip().split()
        for pid in pids:
            subprocess.run(["kill", "-9", pid])
    time.sleep(1)


def start():
    free_port(8000)
    tunnel_thread = threading.Thread(target=start_tunnel, daemon=True)
    tunnel_thread.start()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")


thread = threading.Thread(target=start, daemon=True)
thread.start()
time.sleep(5)
print("Backend is running. Copy the PUBLIC URL above into the AuditLab frontend.")
