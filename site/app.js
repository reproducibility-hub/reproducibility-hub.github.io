// Reproducibility Hub. Reads data/index.json (built by scripts/build.py from reports/) and fetches
// data/runs/<run id>.json (run id = <venue>/<paper_id>_<timestamp>) when a run is opened.
const REPO = "https://github.com/reproducibility-hub/reproducibility-hub.github.io";
const DATA = await (await fetch("data/index.json", { cache: "no-cache" })).json();

const LEVELS = [
  ["RUNS_AS_IS", "--c1", "Runs as-is", "The released scripts run the main experiments without code changes; only command-line arguments or configuration values are set"],
  ["TRIVIAL_FIXES", "--c15", "Trivial fixes", "Only environment-level adjustments are needed, such as pinning dependency versions, setting environment variables or devices, or correcting hard-coded paths"],
  ["MINOR_FIXES", "--c2", "Minor fixes", "Small bugs are corrected without affecting the results, such as missing imports or default settings that differ from the paper"],
  ["MAJOR_FIXES", "--c3", "Major fixes", "The program logic must be changed, often to fix bugs that silently alter the results, e.g. a dataset argument that is never passed, or a leftover debug break that limits evaluation to the first example"],
  ["MISSING_SCRIPTS", "--c4", "Missing scripts", "The method is implemented, but the scripts for the main experiments, such as data processing and evaluation, are missing and must be written from the paper's description"],
  ["MISSING_DATA", "--c45", "Missing data", "Data required for the main experiments, such as the paper's own dataset, annotations, or splits, is not released and must be reconstructed or replaced"],
  ["MISSING_CORE", "--c5", "Missing core", "The implementation of the method itself is incomplete, e.g. key modules are missing, or only inference code is released for a claim that requires training"],
];
const MATCHES = [
  ["NUMBERS_MATCH", "--c1", "Numbers Match", "The reproduced numbers fall within the standard deviation or confidence interval reported in the paper; otherwise, the relative difference is at most 5% or the absolute difference is at most one point on a 0–100 scale"],
  ["TREND_MATCH", "--c2", "Trend Match", "The reproduced numbers fall outside the tolerance, but the paper's conclusions still hold, with the same ranking of methods and direction of improvement"],
  ["MIXED", "--c3", "Mixed", "Some main claims hold while others do not, e.g. the proposed method outperforms the baselines on one dataset but not on another"],
  ["NO_MATCH", "--c5", "No Match", "The results contradict the paper's claims, e.g. the ranking of methods is reversed or the claimed improvement is not observed"],
  ["DOES_NOT_RUN", "--c6", "Does Not Run", "The code cannot produce the main results, e.g. it crashes, the scripts for the main experiments are missing, or the required data is not released"],
];
// A single number in a run's comparison table can also be not comparable, or not run.
const ROW_MATCHES = [...MATCHES,
  ["NOT_COMPARABLE", "--v-blocked", "Not Comparable", "Obtained, but the setting differs too much to compare fairly"],
  [null, "--v-nocode", "Not Run", "This number was not produced"],
];
const COVERAGES = { FULL: "Full", SUBSET: "Subset", SCALED_DOWN: "Scaled down", NONE: "None" };
const FLAGS = {
  METHOD_MISMATCH: ["Code ≠ Paper", "The released code implements a different method from the one described in the paper, e.g. a component the paper presents as essential is never applied, or the algorithm follows a different procedure"],
  CODE_BUG: ["Code Bug", "A bug in the released code changes what it computes, often silently, e.g. a configuration key that disables a module, a label mask that never matches, or state overwritten between batches"],
  EVAL_MISMATCH: ["Eval ≠ Paper", "The evaluation in the released code differs from the paper's, e.g. a different metric, judge or answer extraction, or model selection on the test set"],
  DATA_MISMATCH: ["Data ≠ Paper", "The data used by the released code differs from the paper's, e.g. different splits, preprocessing or subsets, or test data leaking into training"],
  BASELINE_STRONGER_THAN_REPORTED: ["Baseline > Reported", "A baseline run through the released pipeline performs clearly better than reported in the paper, so the claimed improvement of the proposed method shrinks or disappears"],
  RERUN_WEAKER_THAN_RELEASED: ["Rerun < Released", "The released outputs or checkpoints reproduce the reported numbers, but rerunning the released code does not"],
};
const FLAG_COLOR = { METHOD_MISMATCH: "--f-code", CODE_BUG: "--f-bug", EVAL_MISMATCH: "--f-eval", DATA_MISMATCH: "--f-data",
                     BASELINE_STRONGER_THAN_REPORTED: "--f-baseline", RERUN_WEAKER_THAN_RELEASED: "--f-rerun" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Run start time, YYYY-MM-DD-T-HH-MM-SS -> "YYYY-MM-DD HH:MM".
const fmtTs = ts => ts ? `${ts.slice(0, 10)} ${ts.slice(13, 15)}:${ts.slice(16, 18)}` : "";
const mt = m => ROW_MATCHES.find(([n]) => n === m) || [m, "--v-other", String(m), ""];
const mbadge = m => { const [, col, text, desc] = mt(m);
  return `<span class="badge" style="background:var(${col})" title="${esc(desc)}">${esc(text)}</span>`; };
const fbadges = fs => (fs || []).length ? `<div class="flags">` + fs.map(f => { const [text, desc] = FLAGS[f] || [f, f];
  return `<span class="cbadge" style="color:var(${FLAG_COLOR[f] || "--v-blocked"})" title="${esc(desc)}">⚑ ${esc(text)}</span>`; }).join("") + `</div>` : "";
const lvl = c => LEVELS.find(([n]) => n === c) || [c, "--v-other", c, ""];
const cbadge = c => { const [, col, text, desc] = lvl(c);
  return `<span class="badge" style="background:var(${col})" title="${esc(desc)}">${esc(text)}</span>`; };
// Runtime in minutes -> "2d 3h 15m", "15h 19m", "42m".
const fmtMin = m => {
  if (m == null) return "";
  const t = Math.round(m), d = Math.floor(t / 1440), h = Math.floor(t % 1440 / 60), min = t % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, `${min}m`].filter(Boolean).join(" ");
};
// "Claude Code · Opus 5.5"
const harnessModel = r => [r.harness, r.model].filter(Boolean).join(" · ");
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---- Runs, newest first; "entry" = latest run of one paper ----
const runs = DATA.runs.map(r => ({ ...r, key: `${r.venue}/${r.paper_id}`, paper: DATA.papers[`${r.venue}/${r.paper_id}`] || {} }))
  .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
const runById = new Map(runs.map(r => [r.id, r]));
const runsByPaper = new Map();
for (const r of runs) { if (!runsByPaper.has(r.key)) runsByPaper.set(r.key, []); runsByPaper.get(r.key).push(r); }
function latestPer(list, keyOf) {
  const groups = new Map();
  for (const r of list) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return [...groups.values()].map(g => g[0]);
}

// ---- Toolbar: venue scope ----
const venueSel = document.getElementById("venue");
venueSel.innerHTML = `<option value="">All venues</option>` +
  Object.values(DATA.venues).map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("");
venueSel.value = DATA.venues[store.get("venue")] ? store.get("venue") : "";
document.getElementById("updated").textContent =
  `${Object.keys(DATA.papers).length.toLocaleString()} papers · built ` +
  new Date(DATA.generated_at).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" });
let scope;
function computeScope() {
  const v = venueSel.value;
  const pool = runs.filter(r => !v || r.venue === v);
  const entries = latestPer(pool, r => r.key);
  scope = { pool, entries, papers: entries };
}

// ---- Dashboard ----
// Every segment gets its percentage; fitBarLabels hides the ones that don't fit the segment's current width.
function fitBarLabels(bar) {
  for (const b of bar.querySelectorAll("span > b")) b.style.visibility = b.offsetWidth + 4 <= b.parentElement.clientWidth ? "" : "hidden";
}
const barFit = new ResizeObserver(es => es.forEach(e => fitBarLabels(e.target)));
function distBar(barId, legId, key, defs, pool, totId) {
  const counts = new Map();
  for (const a of pool) counts.set(a[key], (counts.get(a[key]) || 0) + 1);
  const order = defs.filter(([n]) => counts.has(n));
  for (const k of counts.keys()) if (!defs.some(([n]) => n === k)) order.push([k, "--v-other", String(k), ""]);
  document.getElementById(barId).innerHTML = pool.length ? order.map(([n, col, text]) =>
    `<span style="width:${100 * counts.get(n) / pool.length}%;background:var(${col})" title="${esc(text)}: ${counts.get(n)}"><b>${Math.round(100 * counts.get(n) / pool.length)}%</b></span>`).join("") : "";
  barFit.observe(document.getElementById(barId));
  fitBarLabels(document.getElementById(barId));
  const pct = n => pool.length ? Math.round(100 * counts.get(n) / pool.length) : 0;
  if (legId) document.getElementById(legId).innerHTML = order.map(([n, col, text]) =>
    `<span><i style="background:var(${col})"></i>${esc(text)} ${counts.get(n)} (${pct(n)}%)</span>`).join("") || "No papers yet";
  if (totId) document.getElementById(totId).textContent = `· n = ${pool.length}`;
}
function renderDashboard() {
  const papers = scope.papers;
  document.getElementById("stat").innerHTML = `<div class="l">Papers</div><div class="n">${papers.length}</div>`;
  distBar("cbar", "cleg", "codebase_completeness", LEVELS, papers, "ctot");
  distBar("rbar-rel", "rleg-rel", "result_as_released", MATCHES, papers, "rtot-rel");
  distBar("rbar-fix", "rleg-fix", "result_after_fixes", MATCHES, papers, "rtot-fix");
  document.getElementById("distnote").textContent = `Codebase and result bars: ${papers.length} papers (latest run each).`;
  renderTable();
}

// Multi-select column filters: a row passes if it matches any checked value (none checked = no filtering).
function multiSelect(id, items) {
  const root = document.getElementById(id), sum = root.querySelector("summary"), menu = root.querySelector(".ms-menu");
  const base = sum.textContent;
  items.forEach(([, html], i) => menu.insertAdjacentHTML("beforeend", `<label><input type="checkbox" value="${i}"> ${html}</label>`));
  menu.insertAdjacentHTML("beforeend", `<span class="ms-clear">Clear</span>`);
  const boxes = () => [...menu.querySelectorAll("input:checked")].map(x => items[+x.value]);
  const update = () => { const n = boxes().length; sum.textContent = n ? `${base} (${n})` : base; root.classList.toggle("active", n > 0); };
  root.addEventListener("toggle", () => {
    if (!root.open) return;
    document.querySelectorAll("th details.ms[open]").forEach(d => { if (d !== root) d.open = false; });
    const r = sum.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  });
  menu.addEventListener("change", () => { update(); renderTable(); });
  menu.querySelector(".ms-clear").onclick = () => { menu.querySelectorAll("input").forEach(x => x.checked = false); update(); renderTable(); };
  document.addEventListener("click", e => { if (!root.contains(e.target)) root.open = false; });
  window.addEventListener("scroll", () => { root.open = false; }, { passive: true });
  update();
  return () => boxes().map(t => t[0]);
}
const used = (key, defs) => defs.filter(([n]) => runs.some(a => a[key] === n));
const fSel = multiSelect("ff", Object.keys(FLAGS).filter(f => runs.some(a => (a.flags || []).includes(f)))
  .map(f => [f, `<span class="cbadge" style="color:var(${FLAG_COLOR[f] || "--v-blocked"})">⚑ ${esc(FLAGS[f][0])}</span>`]));
const cSel = multiSelect("cf", used("codebase_completeness", LEVELS).map(([n]) => [n, cbadge(n)]));
const rSel = multiSelect("rf", used("result_as_released", MATCHES).map(([n]) => [n, mbadge(n)]));
const mSel = multiSelect("mf", used("result_after_fixes", MATCHES).map(([n]) => [n, mbadge(n)]));
const gSel = multiSelect("gf", Object.keys(COVERAGES).filter(k => runs.some(a => a.coverage === k)).map(k => [k, esc(COVERAGES[k])]));

function renderTable() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const pool = document.getElementById("all").checked ? scope.pool : scope.entries;
  const cs = cSel(), rs = rSel(), ms = mSel(), gs = gSel(), fs = fSel();
  const rows = pool.filter(a => (!cs.length || cs.includes(a.codebase_completeness)) &&
    (!fs.length || fs.some(f => (a.flags || []).includes(f))) &&
    (!ms.length || ms.includes(a.result_after_fixes)) &&
    (!rs.length || rs.includes(a.result_as_released)) &&
    (!gs.length || gs.includes(a.coverage)) &&
    (!q || [a.paper.title, a.paper_id].join(" ").toLowerCase().includes(q)));
  document.getElementById("count").textContent = `${rows.length} shown`;
  // Rendering thousands of rows at once is slow on phones; show the first 500 and say so.
  const LIMIT = 500, shown = rows.slice(0, LIMIT);
  document.getElementById("rows").innerHTML = rows.length ? shown.map(a => `
    <tr data-id="${esc(a.id)}">
      <td class="paper"><div class="title">${esc(a.paper.title || a.paper_id)}</div><div class="id">${esc(a.paper_id)}</div>${fbadges(a.flags)}</td>
      <td>${cbadge(a.codebase_completeness)}</td>
      <td>${mbadge(a.result_as_released)}</td>
      <td>${mbadge(a.result_after_fixes)}</td>
      <td class="muted" style="white-space:nowrap">${esc(COVERAGES[a.coverage] ?? a.coverage ?? "")}</td>
      <td style="white-space:nowrap">${esc(a.harness)}<div class="muted">${esc(a.model)}</div></td>
      <td class="num" style="white-space:nowrap">${esc(fmtMin(a.runtime))}</td>
      <td class="muted" style="white-space:nowrap">${fmtTs(a.timestamp)}</td>
    </tr>`).join("") + (rows.length > LIMIT ? `<tr><td colspan="8" class="empty">Showing ${LIMIT} of ${rows.length}. Search or filter to narrow down.</td></tr>` : "")
    : `<tr><td colspan="8" class="empty">No matching attempts</td></tr>`;
}
["q", "all"].forEach(id => document.getElementById(id).addEventListener("input", renderTable));
document.getElementById("rows").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-id]");
  if (tr) openRun(tr.dataset.id);
});

// ---- Contribute ----
function renderContribute() {
  document.getElementById("repo-link").href = `${REPO}/blob/main/CONTRIBUTING.md`;
  const table = (title, note, rows) => `<h3 style="font-size:14px;margin:16px 0 6px">${title}</h3>` +
    `<p class="muted" style="font-size:13px;margin:0 0 6px">${esc(note)}</p><div class="scroll"><table>` +
    rows.map(([b, d]) => `<tr><td style="white-space:nowrap">${b}</td><td class="muted">${esc(d)}</td></tr>`).join("") + `</table></div>`;
  document.getElementById("glossary").innerHTML =
    table("Codebase completeness", "Based on the changes the agent had to make, each codebase gets the most severe applicable level.", LEVELS.map(([n, , , d]) => [cbadge(n), d])) +
    table("Result match (as released / after fixes)", "The agent compares each reproduced number with the paper. The overall level is determined only by the main results that support the paper's central claims, and judges the proposed method rather than the baselines. Each paper is assessed twice: as released, running the code without modifying its source, and after the agent's fixes.", MATCHES.map(([n, , , d]) => [mbadge(n), d])) +
    table("Flags", "Notable cases where the released code cannot support the paper's claims.", Object.entries(FLAGS).map(([f, [, d]]) => [fbadges([f]), d]));
}

// ---- Run detail dialog ----
const dlg = document.getElementById("detail");
const detailCache = new Map();
async function openRun(rid) {
  const a = runById.get(rid);
  if (!a) return;
  const p = a.paper, venue = DATA.venues[a.venue];
  document.getElementById("d-id").textContent = `${a.paper_id} · ${venue?.name || a.venue}`;
  document.getElementById("d-title").textContent = p.title || a.paper_id;
  document.getElementById("d-badge").innerHTML = fbadges(a.flags);
  const link = (href, text) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>` : "";
  const commitUrl = a.code_commit && /^https:\/\/github\.com\//.test(p.code_link || "")
    ? `${p.code_link.replace(/\/$/, "")}/tree/${a.code_commit}` : p.code_link;
  document.getElementById("d-links").innerHTML = link(p.paper_url, "Paper page") + link(commitUrl, "Code") +
    link(`${REPO}/blob/main/reports/${a.id}.md`, "Report file");
  const meta = [
    ["Harness", a.harness], ["Model", a.model], ["Timestamp", fmtTs(a.timestamp)],
    ["Code commit", a.code_commit ? a.code_commit.slice(0, 7) : "—"], ["GPU", a.gpu || "—"],
    ["Runtime", a.runtime != null ? fmtMin(a.runtime) : "—"],
  ];
  document.getElementById("d-meta").innerHTML = meta.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join("");
  document.getElementById("d-history").innerHTML = runsByPaper.get(a.key).map(x =>
    `<a data-id="${esc(x.id)}" class="${x.id === rid ? "cur" : ""}">${mbadge(x.result_after_fixes)} <span>${esc(harnessModel(x))}</span>` +
    `<span class="muted">${fmtTs(x.timestamp)}</span></a>`).join("");
  document.querySelectorAll("#d-history a").forEach(el => el.onclick = () => openRun(el.dataset.id));
  document.getElementById("d-result").innerHTML = `<span class="muted">As released:</span> ${mbadge(a.result_as_released)} ` +
    `<span class="muted">· After fixes:</span> ${mbadge(a.result_after_fixes)} <span class="muted">· coverage: ${esc(COVERAGES[a.coverage] ?? a.coverage)}</span>`;
  document.getElementById("d-cbadge").innerHTML = cbadge(a.codebase_completeness) + ` <span class="muted">${esc(lvl(a.codebase_completeness)[3])}</span>`;
  document.getElementById("d-comp").innerHTML = "";
  document.getElementById("d-report").innerHTML = `<span class="muted">Loading…</span>`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  history.replaceState(null, "", "#/run/" + rid);

  let d = detailCache.get(rid);
  if (!d) {
    try { d = await (await fetch(`data/runs/${rid}.json`, { cache: "no-cache" })).json(); detailCache.set(rid, d); }
    catch { document.getElementById("d-report").innerHTML = `<span class="muted">Couldn't load this run's report.</span>`; return; }
  }
  if (runById.get(rid) !== a || location.hash !== "#/run/" + rid) return;  // user moved on while loading
  document.getElementById("d-comp").innerHTML = comparisonTable(d.comparisons || []);
  const md = d.report || "_No write-up._";
  document.getElementById("d-report").innerHTML = window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(md)) : `<pre>${esc(md)}</pre>`;
}
// Optional per-number table: main results first, then supplementary; as-released columns only when recorded.
function comparisonTable(comps) {
  if (!comps.length) return "";
  const fmt = x => typeof x === "number" ? (Math.abs(x) >= 100 ? x.toFixed(1) : +x.toPrecision(4)) : esc(x ?? "—");
  const rel = comps.some(c => c.ours_as_released != null || c.match_as_released != null);
  const sc = comps.some(c => c.scope);
  const rows = sc ? [...comps].sort((x, y) => (x.scope === "supplementary") - (y.scope === "supplementary")) : comps;
  return `<table><tr>${sc ? "<th>Scope</th>" : ""}<th>Source</th><th>Metric</th><th>Setting</th><th class="num">Paper</th>` +
    (rel ? `<th class="num">As released</th><th>Match</th>` : "") + `<th class="num">${rel ? "After fixes" : "Ours"}</th><th>Match</th></tr>` +
    rows.map(c => `<tr>${sc ? `<td>${c.scope === "supplementary" ? "<span class='muted'>supplementary</span>" : esc(c.scope ?? "—")}</td>` : ""}` +
      `<td>${esc(c.source)}</td><td>${esc(c.metric)}</td><td>${esc(c.setting)}</td><td class="num">${fmt(c.paper)}</td>` +
      (rel ? `<td class="num">${fmt(c.ours_as_released)}</td><td>${c.match_as_released != null ? mbadge(c.match_as_released) : "<span class='muted'>—</span>"}</td>` : "") +
      `<td class="num">${fmt(c.ours)}</td><td>${mbadge(c.match)}</td></tr>`).join("") + "</table>";
}
document.getElementById("d-close").onclick = () => dlg.close();
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => { if (location.hash.startsWith("#/run/")) history.replaceState(null, "", "#" + currentView); });

// ---- Routing: #/ · #/contribute · #/run/<run id> (old #<paper_id> links open that paper's latest run) ----
let currentView = "/";
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("/run/")) return openRun(h.slice(5));
  if (h && !h.startsWith("/")) {
    const r = runs.find(x => x.paper_id === h);
    if (r) return openRun(r.id);
  }
  currentView = h === "/contribute" ? h : "/";
  const view = currentView === "/" ? "dashboard" : currentView.slice(1);
  for (const v of ["dashboard", "contribute"]) document.getElementById(`v-${v}`).hidden = v !== view;
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.dataset.view === view));
  document.getElementById("toolbar").hidden = view === "contribute";
  if (dlg.open) dlg.close();
}
function refresh() { computeScope(); renderDashboard(); }
venueSel.addEventListener("change", () => { store.set("venue", venueSel.value); refresh(); });
window.addEventListener("hashchange", route);
refresh();
renderContribute();
route();
