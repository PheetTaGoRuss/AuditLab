/* ── API URL management ─────────────────────────────────────────────────────
   Priority: localStorage → default placeholder (never hardcoded)
   User can update via the ⚙️ settings modal without touching code.
─────────────────────────────────────────────────────────────────────────── */
const API_URL_KEY = "auditlab_api_url";

function getApiUrl() {
  return localStorage.getItem(API_URL_KEY) || "";
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const settingsBtn    = document.getElementById("settingsBtn");
const settingsModal  = document.getElementById("settingsModal");
const apiUrlInput    = document.getElementById("apiUrlInput");
const saveApiUrlBtn  = document.getElementById("saveApiUrl");
const cancelSettings = document.getElementById("cancelSettings");

const articleText    = document.getElementById("articleText");
const charCount      = document.getElementById("charCount");
const auditBtn       = document.getElementById("auditBtn");
const fileInput      = document.getElementById("fileInput");
const dropZone       = document.getElementById("dropZone");
const fileNameEl     = document.getElementById("fileName");

const progressSection = document.getElementById("progressSection");
const agentRowsEl     = document.getElementById("agentRows");
const resultsSection  = document.getElementById("resultsSection");

const scoreValue  = document.getElementById("scoreValue");
const scoreTier   = document.getElementById("scoreTier");
const scoreDetail = document.getElementById("scoreDetail");

const exportJsonBtn = document.getElementById("exportJson");
const exportTxtBtn  = document.getElementById("exportTxt");

// ── State ────────────────────────────────────────────────────────────────────
let lastResult = null;

const AGENT_META = [
  { id: "logic",       name: "Logic Agent" },
  { id: "citation",    name: "Citation Agent" },
  { id: "statistics",  name: "Statistics Agent" },
  { id: "retrieval",   name: "Retrieval Agent" },
  { id: "consistency", name: "Sci. Consistency Agent" },
  { id: "skeptic",     name: "Skeptic Agent" },
];

// ── Settings modal ────────────────────────────────────────────────────────────
settingsBtn.addEventListener("click", () => {
  apiUrlInput.value = getApiUrl();
  settingsModal.classList.remove("hidden");
});
cancelSettings.addEventListener("click", () => settingsModal.classList.add("hidden"));
settingsModal.addEventListener("click", e => { if (e.target === settingsModal) settingsModal.classList.add("hidden"); });
saveApiUrlBtn.addEventListener("click", () => {
  const url = apiUrlInput.value.trim().replace(/\/$/, "");
  if (url) localStorage.setItem(API_URL_KEY, url);
  settingsModal.classList.add("hidden");
});

// ── Input tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Result tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll(".rtab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".rtab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".rtab-panel").forEach(p => {
      p.classList.remove("active");
      p.classList.add("hidden");
    });
    tab.classList.add("active");
    const panel = document.getElementById(`rtab-${tab.dataset.rtab}`);
    panel.classList.remove("hidden");
    panel.classList.add("active");
  });
});

// ── Char counter ──────────────────────────────────────────────────────────────
articleText.addEventListener("input", () => {
  charCount.textContent = `${articleText.value.length.toLocaleString()} characters`;
});

// ── File upload ───────────────────────────────────────────────────────────────
function loadFile(file) {
  if (!file) return;
  fileNameEl.textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    articleText.value = e.target.result;
    charCount.textContent = `${e.target.result.length.toLocaleString()} characters`;
    document.querySelector('[data-tab="text"]').click();
  };
  reader.readAsText(file);
}
fileInput.addEventListener("change", e => loadFile(e.target.files[0]));
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  loadFile(e.dataTransfer.files[0]);
});

// ── Build agent progress rows ─────────────────────────────────────────────────
function buildAgentRows() {
  agentRowsEl.innerHTML = "";
  AGENT_META.forEach(a => {
    const row = document.createElement("div");
    row.className = "agent-row";
    row.id = `row-${a.id}`;
    row.innerHTML = `
      <span class="agent-status" id="status-${a.id}">⏳</span>
      <span class="agent-name">${a.name}</span>
      <span class="agent-score" id="score-${a.id}">—</span>`;
    agentRowsEl.appendChild(row);
  });
}

// ── Audit ─────────────────────────────────────────────────────────────────────
auditBtn.addEventListener("click", runAudit);

async function runAudit() {
  const text = articleText.value.trim();
  if (!text) { alert("Please paste or upload article text first."); return; }

  const base = getApiUrl();
  if (!base) {
    alert("No API URL set. Click ⚙️ to enter the ngrok URL from Kaggle.");
    settingsModal.classList.remove("hidden");
    return;
  }

  auditBtn.disabled = true;
  lastResult = null;

  // Reset UI
  progressSection.classList.remove("hidden");
  resultsSection.classList.add("hidden");
  buildAgentRows();

  const agentResults = {};

  try {
    const response = await fetch(`${base}/audit/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            handleEvent(data, agentResults);
          } catch { /* partial JSON */ }
        }
      }
    }
  } catch (err) {
    alert(`Connection error: ${err.message}\nCheck that the Kaggle backend is running and the ngrok URL is correct.`);
  } finally {
    auditBtn.disabled = false;
  }
}

function handleEvent(data, agentResults) {
  if (data.event === "agent_start") {
    const statusEl = document.getElementById(`status-${data.agent}`);
    if (statusEl) statusEl.innerHTML = '<span class="spinner">⟳</span>';
  } else if (data.event === "agent_done") {
    const statusEl = document.getElementById(`status-${data.agent}`);
    const scoreEl  = document.getElementById(`score-${data.agent}`);
    if (statusEl) statusEl.textContent = "✅";
    if (scoreEl)  scoreEl.textContent  = data.result.score?.toFixed(1) ?? "—";
    agentResults[data.agent] = data.result;
  } else if (data.event === "final") {
    lastResult = { ...data, agent_results: agentResults };
    renderResults(data, agentResults);
  }
}

// ── Render results ─────────────────────────────────────────────────────────────
function renderResults(final, agentResults) {
  // Score banner
  const score = final.final_score;
  scoreValue.textContent = score.toFixed(1);
  scoreTier.textContent  = final.tier;
  scoreTier.className    = `tier-badge tier-${final.tier}`;
  scoreDetail.textContent = `Bayesian: ${final.bayesian_weighted_mean} · Adjustment: ${final.mechanism_adjustment > 0 ? "+" : ""}${final.mechanism_adjustment}`;

  // Color score by tier
  const tierColors = { LOW: "#3fb950", MEDIUM: "#d29922", HIGH: "#f0883e", CRITICAL: "#f85149" };
  scoreValue.style.color = tierColors[final.tier] || "#e6edf3";

  // Agents tab
  const agentsPanel = document.getElementById("rtab-agents");
  agentsPanel.innerHTML = "";
  AGENT_META.forEach(a => {
    const r = agentResults[a.id] || {};
    const card = document.createElement("div");
    card.className = "agent-card";
    const issuesHtml = (r.issues || []).map(issue => `
      <div class="issue-item">
        <div class="issue-sentence">"${escHtml(issue.sentence || "")}"</div>
        <div class="issue-problem">
          <span class="severity-badge sev-${issue.severity}">${issue.severity}</span>
          ${escHtml(issue.problem || "")}
        </div>
        <div class="issue-correction">✏️ ${escHtml(issue.correction || "")}</div>
      </div>`).join("") || '<p class="hint" style="margin-top:8px">No issues found.</p>';

    card.innerHTML = `
      <div class="agent-card-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="agent-card-title">${a.name}</span>
        <span class="agent-card-score" style="color:${scoreColor(r.score)}">${(r.score ?? "—")}</span>
      </div>
      <div class="agent-card-body">${issuesHtml}</div>`;
    agentsPanel.appendChild(card);
  });

  // Shapley tab
  const shapPanel = document.getElementById("rtab-shapley");
  const shap = final.shapley || {};
  const maxShap = Math.max(...Object.values(shap));
  shapPanel.innerHTML = `<div class="shapley-chart">${
    AGENT_META.map(a => {
      const val = shap[a.id] ?? 0;
      const pct = maxShap > 0 ? (val / maxShap * 100).toFixed(1) : 0;
      return `<div class="shapley-row">
        <span class="shapley-label">${a.name}</span>
        <div class="shapley-bar-bg"><div class="shapley-bar-fill" style="width:${pct}%"></div></div>
        <span class="shapley-val">${val.toFixed(3)}</span>
      </div>`;
    }).join("")
  }</div>`;

  // Debate tab
  const debate = final.debate || {};
  const debatePanel = document.getElementById("rtab-debate");
  const eqColor = { STABLE: "#3fb950", CONTESTED: "#d29922", UNSTABLE: "#f85149" };
  debatePanel.innerHTML = `<div class="debate-block">
    <div class="debate-stat">
      <span class="debate-stat-label">Equilibrium</span>
      <span class="debate-stat-value" style="color:${eqColor[debate.equilibrium] || "#e6edf3"}">${debate.equilibrium ?? "—"}</span>
    </div>
    <div class="debate-stat">
      <span class="debate-stat-label">Attack Surface Ratio</span>
      <span class="debate-stat-value">${(debate.attack_surface_ratio ?? 0).toFixed(3)}</span>
    </div>
    <div class="debate-stat">
      <span class="debate-stat-label">Total Issues Raised</span>
      <span class="debate-stat-value">${debate.total_issues ?? 0}</span>
    </div>
  </div>`;

  // Peer Prediction tab
  const peer = final.peer_prediction || {};
  const peerPanel = document.getElementById("rtab-peer");
  peerPanel.innerHTML = AGENT_META.map(a => {
    const val = peer[a.id] ?? 0;
    return `<div class="peer-row">
      <span class="peer-label">${a.name}</span>
      <div class="peer-bar-bg"><div class="peer-bar-fill" style="width:${(val * 100).toFixed(1)}%"></div></div>
      <span class="peer-val">${val.toFixed(3)}</span>
    </div>`;
  }).join("");

  resultsSection.classList.remove("hidden");
}

// ── Export ────────────────────────────────────────────────────────────────────
exportJsonBtn.addEventListener("click", () => {
  if (!lastResult) return;
  download("auditlab_result.json", JSON.stringify(lastResult, null, 2), "application/json");
});

exportTxtBtn.addEventListener("click", () => {
  if (!lastResult) return;
  const r = lastResult;
  const lines = [
    "AuditLab Result",
    "================",
    `Final Score: ${r.final_score} / 10 (${r.tier})`,
    `Bayesian Mean: ${r.bayesian_weighted_mean}  |  Mechanism Adjustment: ${r.mechanism_adjustment}`,
    "",
    "Agent Scores:",
    ...AGENT_META.map(a => `  ${a.name}: ${r.agent_scores?.[a.id] ?? "—"}`),
    "",
    "Shapley Values:",
    ...AGENT_META.map(a => `  ${a.name}: ${r.shapley?.[a.id]?.toFixed(4) ?? "—"}`),
    "",
    `Debate Equilibrium: ${r.debate?.equilibrium}  |  Attack Surface: ${r.debate?.attack_surface_ratio}`,
    "",
    "Issues by Agent:",
    ...AGENT_META.flatMap(a => {
      const issues = r.agent_results?.[a.id]?.issues || [];
      if (!issues.length) return [`  ${a.name}: No issues`];
      return [
        `  ${a.name}:`,
        ...issues.map(i => `    [${i.severity}] "${i.sentence}"\n    Problem: ${i.problem}\n    Fix: ${i.correction}`),
      ];
    }),
  ];
  download("auditlab_result.txt", lines.join("\n"), "text/plain");
});

function download(filename, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function scoreColor(score) {
  if (score == null) return "#8b949e";
  if (score >= 7.5) return "#3fb950";
  if (score >= 5.5) return "#d29922";
  if (score >= 3.5) return "#f0883e";
  return "#f85149";
}
