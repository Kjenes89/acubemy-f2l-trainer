import { SOLVED, OPPOSITE, turn, f2lSolved } from "./cube.js";
import { expand, invert, simplify, canonical, heldNotation } from "./alg.js";
import { CASES, CASE_BY_N, DEFAULT_SELECTION, LL_SCRAMBLERS } from "./cases.js";
import { cubeSvg } from "./view.js";

let view3d = null;
const dimNow = () => S.phase === "case";

const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window;
const rnd = (n) => Math.floor(Math.random() * n);
const fmt = (ms) => (ms / 1000).toFixed(2);

const S = {
  facelets: SOLVED,
  history: [], // våre siste tilstander; en tilstand fra acubemy som finnes her er gammel og ignoreres
  mode: "drill", // drill | guided
  shortSetup: false,
  selection: new Set(DEFAULT_SELECTION),
  phase: "wait", // wait (venter på løst F2L) | setup | case
  cur: null,
  last: null,
  repeat: null,
  stats: {},
};

// ---------- sporing av en forventet trekkrekke (oppsett eller algoritme) ----------
class Tracker {
  constructor(items) { this.items = items.map((m) => ({ ...m })); }
  get done() { return this.items.length === 0; }
  get correcting() { return this.items.length > 0 && this.items[0].corr; }
  step(face, a) {
    const it = this.items;
    let i = 0;
    if (it[0] && it[0].face !== face && it[1] && OPPOSITE[it[0].face] === it[1].face && it[1].face === face && !it[0].corr) i = 1;
    if (it[i] && it[i].face === face) {
      it[i].amt = (it[i].amt - a + 4) % 4;
      if (!it[i].amt) it.splice(i, 1);
      return true;
    }
    if (it[0] && it[0].corr && it[0].face === face) { /* dekket over */ }
    it.unshift({ face, amt: (4 - a) % 4, corr: true });
    return false;
  }
}

// Slå sammen AUF med eventuelle U-trekk i starten av algoritmen.
function withPreAuf(aufAmt, algMoves) {
  const moves = algMoves.map((m) => ({ ...m }));
  let amt = aufAmt, tok = -1;
  while (moves.length && moves[0].face === "D") { amt += moves[0].amt; tok = moves[0].tok; moves.shift(); }
  amt %= 4;
  return { items: amt ? [{ face: "D", amt, tok }, ...moves] : moves, skippedTok: amt ? -1 : tok };
}

// ---------- casevalg og oppsett ----------
function pickCase() {
  if (S.repeat && S.selection.has(S.repeat)) return CASE_BY_N[S.repeat];
  const pool = [...S.selection];
  if (!pool.length) return null;
  let n = pool[rnd(pool.length)];
  if (pool.length > 1 && S.last && n === S.last.n) n = pool.filter((x) => x !== S.last.n)[rnd(pool.length - 1)];
  return CASE_BY_N[n];
}

function startSetup() {
  const c = pickCase();
  if (!c) { S.phase = "wait"; render(); return; }
  const alg = expand(c.alg);
  const pre = [];
  if (!S.shortSetup) {
    pre.push(...expand(LL_SCRAMBLERS[rnd(LL_SCRAMBLERS.length)]).moves);
    pre.push({ face: "D", amt: rnd(4) });
  }
  const auf = rnd(4);
  const setup = simplify([...pre, ...invert(alg.moves), { face: "D", amt: auf }]);
  S.cur = { c, alg, auf: (4 - auf) % 4, setupText: setup.map(heldNotation), setup: new Tracker(setup), executed: [], setupDone: 0 };
  S.phase = "setup";
  render();
}

function startCase() {
  const cur = S.cur;
  const { items, skippedTok } = withPreAuf(cur.auf, cur.alg.moves);
  cur.guide = new Tracker(items);
  cur.skippedTok = skippedTok;
  cur.t0 = performance.now();
  cur.firstMove = null;
  S.phase = "case";
  render();
  tick();
}

function finishCase() {
  const cur = S.cur;
  const t = performance.now() - cur.t0;
  const did = canonical(cur.executed);
  const accepted = [cur.c.alg, ...cur.c.alts].map((a) => canonical(expand(a).moves));
  const ok = accepted.includes(did);
  const quarters = (ms) => simplify(ms).filter((m) => m.face !== "D").reduce((s, m) => s + (m.amt === 2 ? 2 : 1), 0);
  const rawQ = cur.executed.filter((m) => m.face !== "D").length;
  const fixed = ok && rawQ > quarters(cur.alg.moves);
  const res = {
    n: cur.c.n, ok, fixed, time: t, rec: cur.firstMove != null ? cur.firstMove - cur.t0 : null,
    guided: S.mode === "guided",
    did: simplify(cur.executed).map(heldNotation).join(" "),
  };
  const st = (S.stats[cur.c.n] ||= { reps: 0, ok: 0, times: [] });
  st.reps++;
  if (ok) { st.ok++; if (!res.guided) st.times.push(t); }
  S.last = res;
  S.repeat = ok ? null : cur.c.n;
  startSetup();
}

// ---------- trekk inn ----------
function onMove(face, a, ts) {
  S.history.push(S.facelets);
  if (S.history.length > 12) S.history.shift();
  S.facelets = turn(S.facelets, face, a);
  if (view3d) view3d.move(face, a, S.facelets, dimNow());
  if (S.phase === "wait") {
    if (f2lSolved(S.facelets)) startSetup(); else render();
    return;
  }
  if (S.phase === "setup") {
    S.cur.setup.step(face, a);
    if (S.cur.setup.done) startCase(); else render();
    return;
  }
  if (S.phase === "case") {
    const cur = S.cur;
    if (cur.firstMove == null) cur.firstMove = performance.now();
    cur.executed.push({ face, amt: a });
    cur.guide.step(face, a);
    if (f2lSolved(S.facelets)) finishCase(); else render();
  }
}

// ---------- visning ----------
function tick() {
  if (S.phase !== "case") return;
  const el = $("timer");
  if (el) el.textContent = fmt(performance.now() - S.cur.t0);
  requestAnimationFrame(tick);
}

function chips(list, cls = "") {
  return list.map((t) => `<span class="mv ${cls}">${t}</span>`).join("");
}

function setupHtml(cur) {
  const it = cur.setup.items;
  if (cur.setup.correcting) {
    const fixes = [];
    for (const m of it) { if (!m.corr) break; fixes.push(heldNotation(m)); }
    return `<div class="fix">Feil trekk – angre: ${chips(fixes, "bad")}</div>`;
  }
  const remaining = it.map(heldNotation);
  const doneN = Math.max(0, cur.setupText.length - remaining.length);
  return `<div class="scr">${chips(cur.setupText.slice(0, doneN), "done")}${remaining.length ? `<span class="mv now">${remaining[0]}</span>` : ""}${chips(remaining.slice(1))}</div>`;
}

function algHtml(cur, guided) {
  const toks = cur.alg.tokens;
  if (!guided) return "";
  const it = cur.guide.items;
  if (cur.guide.correcting) {
    const fixes = [];
    for (const m of it) { if (!m.corr) break; fixes.push(heldNotation(m)); }
    return `<div class="fix">Annet trekk enn algoritmen – angre: ${chips(fixes, "bad")}</div>` + algLine(cur, it.find((m) => !m.corr));
  }
  return algLine(cur, it[0]);
}

function algLine(cur, head) {
  const toks = cur.alg.tokens;
  const nowTok = head ? head.tok : toks.length;
  const auf = head && head.tok === -1 ? `<span class="mv now">${heldNotation(head)}</span><span class="sep">AUF</span>` : "";
  const parts = toks.map((t, i) => {
    const cls = i < nowTok || i === cur.skippedTok ? "done" : i === nowTok ? "now" : "";
    return `<span class="mv ${cls}">${t}</span>`;
  }).join("");
  return `<div class="alg">${auf}${parts}</div>`;
}

function resultHtml() {
  const r = S.last;
  if (!r) return `<p class="muted">Ingen caser løst ennå.</p>`;
  const c = CASE_BY_N[r.n];
  const verdict = r.ok
    ? `<span class="good">Valgt løsning${r.fixed ? " (med retting)" : ""}</span>`
    : `<span class="badtxt">Annen løsning – casen kommer igjen</span>`;
  return `<div class="res">
    <div class="resrow"><b>${c.n}</b><span class="muted">bok ${c.bookNo}, s. ${c.bookPage}</span><span class="t">${fmt(r.time)}</span></div>
    <div>${verdict}${r.guided ? ' <span class="muted">(guidet)</span>' : ""}</div>
    ${r.rec != null ? `<div class="muted">Til første trekk: ${fmt(r.rec)} s</div>` : ""}
    ${r.ok ? "" : `<div class="cmp"><div><span class="muted">Valgt:</span> ${c.alg}</div>
      <div class="muted small">Uten rotasjoner (slik kuben måler):</div>
      <div><span class="muted">Valgt:</span> ${simplify(expand(c.alg).moves).map(heldNotation).join(" ")}</div>
      <div><span class="muted">Du:</span> ${r.did || "–"}</div></div>`}
  </div>`;
}

function statsHtml() {
  const rows = CASES.filter((c) => S.stats[c.n]).map((c) => {
    const s = S.stats[c.n];
    const mean = s.times.length ? fmt(s.times.reduce((a, b) => a + b, 0) / s.times.length) : "–";
    const best = s.times.length ? fmt(Math.min(...s.times)) : "–";
    return `<tr><td>${c.n}</td><td>${c.bookNo}</td><td>${s.ok}/${s.reps}</td><td>${mean}</td><td>${best}</td></tr>`;
  }).join("");
  if (!rows) return "";
  return `<table><thead><tr><th>acubemy</th><th>bok</th><th>valgt alg</th><th>snitt</th><th>beste</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="muted small">Snitt og beste bare for drill-forsøk med valgt løsning. Lagres ikke ennå (kommer i M2).</p>`;
}

function render() {
  const cur = S.cur;
  let main = "";
  if (S.phase === "wait") {
    main = S.selection.size
      ? `<div class="big">Løs F2L (siste lag kan stå uløst), hold hvit ned og grønn foran.</div>`
      : `<div class="big">Velg minst én case.</div>`;
  } else if (S.phase === "setup") {
    main = `<div class="label">Oppsett</div>${setupHtml(cur)}`;
  } else if (S.phase === "case") {
    const guided = S.mode === "guided";
    main = `<div class="caseinfo"><b>${cur.c.n}</b> <span class="muted">bok ${cur.c.bookNo} · s. ${cur.c.bookPage} · ${cur.c.source}</span></div>
      ${view3d ? "" : `<div class="cube">${cubeSvg(S.facelets)}</div>`}
      <div id="timer" class="timer">0.00</div>
      ${algHtml(cur, guided)}`;
  }
  $("phase").innerHTML = main;
  if (view3d && S.phaseShown !== S.phase) { S.phaseShown = S.phase; view3d.redim(dimNow()); }
  $("result").innerHTML = resultHtml();
  $("stats").innerHTML = statsHtml();
  $("sel-count").textContent = `${S.selection.size} valgt`;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
}

function renderPicker() {
  $("picker").innerHTML = CASES.map((c) =>
    `<button class="case ${S.selection.has(c.n) ? "on" : ""}" data-n="${c.n}" title="${c.alg}">
      <span class="n">${c.n}</span><span class="b">bok ${c.bookNo}</span><span class="a">${c.alg}</span></button>`).join("");
}

// ---------- oppkobling ----------
function bind() {
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { S.mode = b.dataset.mode; render(); }));
  $("short").addEventListener("change", (e) => { S.shortSetup = e.target.checked; });
  $("toggle-picker").addEventListener("click", () => { $("picker-wrap").hidden = !$("picker-wrap").hidden; renderPicker(); });
  $("picker").addEventListener("click", (e) => {
    const b = e.target.closest(".case"); if (!b) return;
    const n = +b.dataset.n;
    S.selection.has(n) ? S.selection.delete(n) : S.selection.add(n);
    renderPicker(); render();
  });
  $("sel-all").addEventListener("click", () => { CASES.forEach((c) => S.selection.add(c.n)); renderPicker(); render(); });
  $("sel-none").addEventListener("click", () => { S.selection.clear(); renderPicker(); render(); });
  $("sel-asker").addEventListener("click", () => { S.selection = new Set(DEFAULT_SELECTION); renderPicker(); render(); });
  $("calib").addEventListener("click", () => { if (window.acubemy) acubemy.calibrateGyro(); });
  $("skip").addEventListener("click", () => { S.repeat = null; S.phase = "wait"; S.cur = null; if (f2lSolved(S.facelets)) startSetup(); else render(); });
}

async function boot() {
  bind();
  try {
    const { Cube3D } = await import("./view3d.js");
    view3d = new Cube3D($("cube3d"));
    view3d.set(S.facelets, false);
  } catch (e) {
    console.warn("3D-visning utilgjengelig, bruker 2D", e);
    $("cube3d").hidden = true;
  }
  if (window.acubemy) {
    acubemy.onDeviceChange((d) => {
      $("device").textContent = d.connected ? d.deviceName || "Kube tilkoblet" : "Ingen kube – koble til i acubemy";
      $("device").className = d.connected ? "ok" : "warn";
    });
    acubemy.onStateChange((f) => {
      // acubemy sender tilstanden sammen med trekket, men den kan være fra før trekket.
      // Vi følger trekkene selv og bruker acubemys tilstand bare når den er helt ny (f.eks. etter reset).
      if (!f || f.length !== 54 || f === S.facelets || S.history.includes(f)) return;
      S.facelets = f;
      S.history = [];
      if (view3d) view3d.set(f, dimNow());
      if (S.phase === "wait" && f2lSolved(f)) startSetup(); else render();
    });
    acubemy.onGyro((q) => { if (view3d) view3d.setGyro(q); });
    acubemy.onMove(({ face, prime, timestamp }) => onMove(face, prime ? 3 : 1, timestamp));
    if (embedded) S.facelets = acubemy.getFacelets();
  }
  if (!embedded) $("device").textContent = "Utenfor acubemy: tastene U R F D L B (Shift = mot klokka) simulerer kuben i kubens egen ramme";
  window.__sim = (mv) => { const f = mv[0]; const a = mv.includes("2") ? 2 : mv.includes("'") ? 3 : 1; for (let i = 0; i < (a === 2 ? 2 : 1); i++) onMove(f, a === 2 ? 1 : a, performance.now()); };
  window.__state = S;
  if (f2lSolved(S.facelets)) startSetup(); else render();
}

boot();
