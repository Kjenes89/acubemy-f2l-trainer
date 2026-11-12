// PLL-trener på samme motor som F2L-treneren: virtuell kube (casen lages på skjermen), trekkene fra den
// fysiske kuben brukes på den, gyroen gir grepet, og bare Vegards algoritme godtas.
// Moduser: Drill (tilfeldig), Weighted (svake oftere), På rad (N riktige på rad per case), Guidet.
// Gjenkjenning trenes i PLL-recognition-appen (to sider, case → pre-AUF → post-AUF).
import { SOLVED, turn, applyMoves } from "./cube.js";
import { expand, invert, tokenize, gripNotation, yNeeded, START_GRIP, rotateGrip } from "./alg.js";
import { Tracker, withPreAuf, sameSolution, didInYourGrip } from "./solve.js";
import { log, flush, LOG_URL } from "./log.js";
import { PLLS, PLL_BY_NAME, PLL_GROUPS } from "./pllcases.js";
import { cubeSvg } from "./view.js";

const rnd = (n) => Math.floor(Math.random() * n);
const fmt = (ms) => (ms / 1000).toFixed(2);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const strictGrip = (a) => !/[rludfbMES]|w/.test(a); // brede trekk/slices: grepet kan ikke leses sikkert

// ---------- ren logikk (testet i tests/pll.test.mjs) ----------
/** En forekomst: tilfeldig pre-AUF og post-AUF. pre/post = U-trekkene (sensor D) som trengs før/etter. */
export function makeInstance(c, colorSwap = true) {
  const mv = expand(c.exec).moves;
  const p = rnd(4), q = rnd(4);
  let st = turn(SOLVED, "D", q); // siste lag skrudd q: etter algoritmen trengs post-AUF
  st = applyMoves(st, invert(mv));
  st = turn(st, "D", p);
  return { state: st, pre: (4 - p) % 4, post: (4 - q) % 4, colorShift: colorSwap ? rnd(4) : 0 };
}

/** Vegards algoritme? Samme flatetrekk og samme grep ved hvert trekk (rotasjonene inne i algoritmen må gjøres),
 *  fra hvilket som helst y-startgrep (å stå rotert i stedet for å ta AUF er tregt, men samme algoritme). */
export function judge(c, executed) {
  return [c.exec, ...c.alts].some((a) => [0, 1, 2, 3].some((k) =>
    sameSolution(executed, expand(a, rotateGrip(START_GRIP, "y", k)).moves, { strictGrip: strictGrip(a) })));
}

// ---------- tilstand ----------
const P = {
  mode: "drill", // drill | weighted | rad | guided
  baseMode: "drill",
  selection: new Set(PLLS.map((c) => c.name)),
  rad: { n: 3, queue: [], idx: 0, streak: 0 },
  colorSwap: true,
  phase: "idle", cur: null, last: null, repeat: null, lastName: null,
  stats: {}, hist: {}, block: null,
};
let ctx = null; // { view3d, beep, onBlockDone }
if (typeof window !== "undefined") window.__pll = P; // for tester
const $ = (id) => document.getElementById(id);
const liveGrip = () => (ctx && ctx.liveGrip ? ctx.liveGrip() : ctx && ctx.view3d ? ctx.view3d.grip() : null); // samme gyrokilde som F2L
const MODE_NAME = { drill: "Drill", weighted: "Weighted", rad: "På rad", guided: "Guidet" };

// ---------- casevalg ----------
const selected = () => PLLS.filter((c) => P.selection.has(c.name));
function weakness(name) {
  const st = P.stats[name], h = P.hist[name] || {};
  const med = st && st.times.length ? median(st.times) : h.medianTotal;
  const fails = st ? st.reps - st.ok : 0;
  return (med ?? 99999) + fails * 1500;
}
function buildRad() {
  P.rad.queue = selected().map((c) => c.name).sort((a, b) => weakness(b) - weakness(a));
  P.rad.idx = 0; P.rad.streak = 0;
}
function pick() {
  const sel = selected();
  if (!sel.length) return null;
  if (P.repeat && P.selection.has(P.repeat)) return PLL_BY_NAME[P.repeat];
  if (P.mode === "rad" || (P.mode === "guided" && P.baseMode === "rad")) {
    const name = P.rad.queue[P.rad.idx];
    return name ? PLL_BY_NAME[name] : null;
  }
  if (P.mode === "weighted") {
    const w = sel.map((c) => Math.max(1, weakness(c.name) / 1000) ** 2);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < sel.length; i++) { r -= w[i]; if (r <= 0) return sel[i]; }
    return sel[sel.length - 1];
  }
  const pool = sel.length > 1 ? sel.filter((c) => c.name !== P.lastName) : sel;
  return pool[rnd(pool.length)];
}

// ---------- case ----------
function startCase(same = false) {
  let c = same && P.cur ? P.cur.c : pick();
  // I en blokk slutter ikke runden blokka: si fra én gang og start en ny runde (avslutt selv).
  if (!c && P.block && P.mode === "rad" && P.rad.queue.length) {
    if (!P.block.goalWarned) { P.block.goalWarned = true; ctx.beep(3); flash("Runden er ferdig – fortsett eller avslutt"); }
    buildRad(); c = pick();
  }
  if (!c) {
    const radDone = P.mode === "rad" && P.rad.queue.length;
    P.phase = "idle"; P.cur = null; render();
    if (radDone) $("p-phase").innerHTML = `<div class="big">Runden er ferdig: ${P.rad.queue.length} caser, ${P.rad.n} riktige på rad hver.</div>`;
    return;
  }
  const inst = same && P.cur ? P.cur.inst : makeInstance(c, P.colorSwap);
  const items = withPreAuf(inst.pre, expand(c.exec).moves).items;
  if (inst.post) items.push({ face: "D", amt: inst.post, tok: -2, auf: true });
  P.cur = {
    c, inst, state: inst.state, guide: new Tracker(items), executed: [], recent: [],
    startSet: new Set([0, 1, 2, 3].map((k) => turn(inst.state, "D", k))),
    t0: performance.now(), execStart: null,
  };
  P.lastName = c.name;
  P.phase = "case";
  if (ctx.view3d) { ctx.view3d.fixed = false; ctx.view3d.setColorShift(inst.colorShift); ctx.view3d.set(inst.state, false); }
  render();
  tick();
}

function finish() {
  const cur = P.cur, end = performance.now();
  const execStart = cur.execStart ?? end;
  const rec = execStart - cur.t0, exec = end - execStart;
  const ok = judge(cur.c, cur.executed);
  const guided = P.mode === "guided";
  const st = (P.stats[cur.c.name] ||= { reps: 0, ok: 0, times: [], rec: [], exec: [] });
  // Referanser før dette forsøket: beste tid (14 dager + i dag) og medianen din (14 dager, ellers i dag).
  const h = P.hist[cur.c.name] || {};
  const prevBest = [h.best, ...st.times].filter((x) => x != null).reduce((a, b) => Math.min(a, b), Infinity);
  const refMedian = h.medianTotal ?? median(st.times);
  st.reps++;
  if (ok) { st.ok++; if (!guided) { st.times.push(rec + exec); st.rec.push(rec); st.exec.push(exec); } }
  // Post-AUF: tid fra siste trekk i algoritmen (siste trekk som ikke er U) til kuben er løst, og om
  // post-AUF-en ble tatt rett (korteste vei, uten å gå feil vei først).
  let lastAlg = -1;
  cur.executed.forEach((m, i) => { if (m.face !== "D") lastAlg = i; });
  let postMs = null, postOk = null;
  if (lastAlg >= 0 && cur.executed[lastAlg].t != null) {
    const tail = cur.executed.slice(lastAlg + 1);
    const q = tail.reduce((n, m) => n + (m.amt === 2 ? 2 : 1), 0);
    const need = cur.inst.post === 2 ? 2 : cur.inst.post ? 1 : 0;
    postMs = need ? Math.round(end - cur.executed[lastAlg].t) : 0;
    postOk = q === need;
  }
  const total = rec + exec;
  const praise = !ok || guided ? null
    : isFinite(prevBest) && total < prevBest ? { pb: true, text: `Ny pers på ${cur.c.name}! ${fmt(total)} (forrige ${fmt(prevBest)})` }
    : refMedian != null && total < refMedian ? { pb: false, text: `Raskere enn medianen din (−${fmt(refMedian - total)} s)` } : null;
  P.last = { c: cur.c, ok, rec, exec, guided, did: didInYourGrip(cur.executed), median: median(st.times), postMs, postOk, postNeed: cur.inst.post, praise };
  log({
    block: P.block ? P.block.id : null, trainer: "pll", mode: P.mode, case: cur.c.name, ok,
    rec: Math.round(rec), exec: Math.round(exec), did: P.last.did, alg: cur.c.exec,
    auf: cur.inst.pre, postAuf: cur.inst.post, colorShift: cur.inst.colorShift,
    postAufMs: postMs, postAufOk: postOk,
  });
  if (P.mode === "rad" && !guided) {
    P.rad.streak = ok ? P.rad.streak + 1 : 0;
    if (P.rad.streak >= P.rad.n) { P.rad.idx++; P.rad.streak = 0; }
  }
  P.repeat = ok && !guided ? null : cur.c.name; // feil: samme case igjen · guidet: samme til du går ut
  if (guided) {
    P.phase = "pause"; render();
    setTimeout(() => { if (P.phase === "pause") startCase(); }, 400);
    return;
  }
  if (!ok) ctx.beep(1);
  else if (praise && praise.pb) ctx.beep(2);
  P.phase = "result";
  P.resultRecent = [];
  render();
}

// ---------- trekk ----------
function fourInRow(list, face, a, now) {
  return list.length === 4 && list.every((m) => m.face === face && m.a === a) && now - list[0].t < 1500;
}
export function onMove(face, a) {
  if (P.block && P.block.pausedAt) return;
  const now = performance.now();
  if (P.phase === "result") {
    // Gul U (kubens D) = neste. Rød L4 (kubens R) = samme case igjen.
    P.resultRecent = [...(P.resultRecent || []), { face, a, t: now }].slice(-4);
    if (face === "D") startCase();
    else if (face === "R" && fourInRow(P.resultRecent, face, a, now)) startCase(true);
    return;
  }
  if (P.phase !== "case") return;
  const cur = P.cur;
  cur.state = turn(cur.state, face, a);
  if (ctx.view3d) ctx.view3d.move(face, a, cur.state, false);
  const mv = { face, amt: a, grip: liveGrip() || cur.lastGrip || START_GRIP, t: now };
  cur.lastGrip = mv.grip;
  mv.grips = [mv.grip];
  setTimeout(() => { const g = liveGrip(); if (g) mv.grips.push(g); }, 120);
  cur.executed.push(mv);
  cur.guide.step(face, a, P.mode === "guided" ? liveGrip() : null);
  if (cur.execStart == null && face !== "D") cur.execStart = now;
  else if (cur.execStart != null && cur.startSet.has(cur.state)) cur.execStart = null; // tilbake i casen: tiden nullstilles
  cur.recent = [...cur.recent, { face, a, t: now }].slice(-4);
  // Hvit D4 (kubens U) = samme case på nytt, rød L4 (kubens R) = neste case – som i F2L-drillen.
  // Casen er virtuell, så etter en tabbe trenger du ikke rette opp kuben for hånd.
  if (face === "U" && fourInRow(cur.recent, face, a, now)) { flash("Samme case igjen"); startCase(true); return; }
  if (face === "R" && fourInRow(cur.recent, face, a, now)) {
    flash("Neste case"); P.repeat = null; if (P.mode === "rad") { P.rad.idx++; P.rad.streak = 0; } startCase(); return;
  }
  if (face === "D" && fourInRow(cur.recent, face, a, now)) {
    // Gul U4 = kalibrer gyro. Fire U-trekk endrer ingenting, så de tas ut av forsøket.
    if (window.acubemy) acubemy.calibrateGyro();
    cur.executed.splice(-4); cur.recent = [];
    const items = withPreAuf(cur.inst.pre, expand(cur.c.exec).moves).items;
    if (cur.inst.post) items.push({ face: "D", amt: cur.inst.post, tok: -2, auf: true });
    cur.guide = new Tracker(items);
    for (const m of cur.executed) cur.guide.step(m.face, m.amt);
    flash("Gyro kalibrert");
  }
  if (cur.state === SOLVED) finish(); else render();
}
export function onGrip() { if (P.phase === "case") render(); }

// ---------- visning ----------
let ticking = false;
function tick() {
  if (ticking) return;
  ticking = true;
  const loop = () => {
    if (P.phase !== "case" || !P.cur || !active) { ticking = false; return; }
    const el = $("p-timer");
    if (el) el.textContent = P.cur.execStart != null ? fmt(performance.now() - P.cur.execStart) : "0.00";
    if (P.block) blockTick();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function flash(text) {
  const el = $("p-flash");
  el.textContent = text; el.classList.add("on");
  clearTimeout(flash.t); flash.t = setTimeout(() => el.classList.remove("on"), 900);
}
const AUF = ["", "U", "U2", "U'"];
function guideHtml(cur) {
  const toks = tokenize(cur.c.exec);
  const items = cur.guide.items;
  const corr = items.filter((m) => m.corr);
  const next = items.find((m) => !m.corr);
  const nowTok = next ? (next.tok === -1 ? -1 : next.tok === -2 ? toks.length : next.tok) : toks.length + 1;
  const isRot = (t) => /^[xyz]/.test(t);
  const preDone = nowTok !== -1;
  let html = cur.inst.pre ? `<span class="mv auf ${preDone ? "done" : "now"}">(${AUF[cur.inst.pre]})</span>` : "";
  html += toks.map((t, i) => {
    // en rotasjon lyser til trekket etter den er tatt
    const cls = i < nowTok ? (isRot(t) && i === nowTok - 1 && next && next.tok === nowTok ? "now" : "done") : i === nowTok ? "now" : "";
    return `<span class="mv ${cls}">${t}</span>`;
  }).join("");
  if (cur.inst.post) html += `<span class="mv auf ${nowTok === toks.length ? "now" : nowTok > toks.length ? "done" : ""}">(${AUF[cur.inst.post]})</span>`;
  const g = liveGrip() || START_GRIP;
  const fix = corr.length ? `<div class="fix">Angre: ${corr.map((m) => `<span class="mv bad">${gripNotation(m, g)}</span>`).join("")}</div>` : "";
  return `<div class="alg">${html}</div>${fix}`;
}
function reminder(cur) {
  const g = liveGrip();
  if (!g || cur.execStart != null) return "";
  const need = yNeeded(g, START_GRIP);
  return need ? `<div class="warnline">Kuben står rotert – ${need} for å holde grønn foran</div>` : "";
}
function resultHtml() {
  const L = P.last;
  const t = L.rec + L.exec;
  return `<div class="res">
    <div class="caseinfo"><b>${L.c.name}</b> ${L.ok ? `<span class="good">✓</span>` : `<span class="badtxt">✗ ikke din algoritme</span>`}</div>
    <div class="timer${L.praise ? " fast" : ""}">${fmt(t)}</div>
    ${L.praise ? `<div class="${L.praise.pb ? "pbline" : "okline"}">${L.praise.text}</div>` : ""}
    <div class="muted">gjenkjenning ${fmt(L.rec)} · utførelse ${fmt(L.exec)}${L.median != null ? ` · median ${fmt(L.median)}` : ""}${L.postNeed && L.postMs != null ? ` · post-AUF ${fmt(L.postMs)} ${L.postOk ? "✓" : "✗ omvei"}` : ""}</div>
    ${L.ok ? "" : `<div class="cmp"><div>Du gjorde: ${L.did}</div><div>Skal være: ${L.c.exec}</div></div>`}
    <div class="muted small">U = ${L.ok ? "neste" : "samme case igjen"} · rød L4 = gjenta</div></div>`;
}
function render() {
  if (!active) return;
  const cur = P.cur;
  let main = "";
  if (P.phase === "idle" || !cur) main = $("p-phase").innerHTML && P.phase === "idle" && P.rad.queue.length && P.mode === "rad" ? $("p-phase").innerHTML : `<div class="big">Velg minst én case.</div>`;
  else if (P.phase === "result") main = resultHtml();
  else {
    main = `${ctx.view3d ? "" : `<div class="cube">${cubeSvg(cur.state, { dimLastLayer: false })}</div>`}
      <div id="p-timer" class="timer">${cur.execStart != null ? fmt(performance.now() - cur.execStart) : "0.00"}</div>
      ${P.mode === "guided" ? `<div class="hint">${cur.c.name}</div>${guideHtml(cur)}` : ""}
      ${P.mode === "rad" && P.rad.queue.length ? `<div class="radprog">Case ${Math.min(P.rad.idx + 1, P.rad.queue.length)} av ${P.rad.queue.length} · ${"●".repeat(P.rad.streak)}${"○".repeat(Math.max(0, P.rad.n - P.rad.streak))}</div>` : ""}
      ${reminder(cur)}`;
  }
  if (P.block) main = `<div class="radprog">Blokk: ${P.block.name} · <span id="p-blocktimer"></span> <button id="p-pauseblock">${P.block.pausedAt ? "Fortsett" : "Pause"}</button> <button id="p-stopblock">Avslutt</button></div>` + main;
  $("p-phase").innerHTML = main;
  if ($("p-stopblock")) $("p-stopblock").onclick = endBlock;
  if ($("p-pauseblock")) $("p-pauseblock").onclick = togglePause;
  $("p-stage").hidden = P.phase === "result" || P.phase === "idle";
  document.querySelectorAll("[data-pmode]").forEach((b) => b.classList.toggle("on", b.dataset.pmode === P.mode));
  $("p-rad-opts").hidden = !(P.mode === "rad" || (P.mode === "guided" && P.baseMode === "rad"));
  $("p-sel-count").textContent = `${P.selection.size} valgt`;
  $("p-result").innerHTML = P.last ? `<b>${P.last.c.name}</b> ${P.last.ok ? "✓" : "✗"} ${fmt(P.last.rec + P.last.exec)} s` : "Ingen caser løst ennå.";
  $("p-stats").innerHTML = statsHtml();
  if (P.block) blockTick();
}
function statsHtml() {
  const rows = PLLS.filter((c) => P.stats[c.name] || (P.hist[c.name] && P.selection.has(c.name))).map((c) => {
    const s = P.stats[c.name], h = P.hist[c.name] || {};
    return `<tr><td>${c.name}</td><td>${s ? `${s.ok}/${s.reps}` : "–"}</td><td>${s && s.times.length ? fmt(median(s.times)) : "–"}</td><td class="muted">${h.medianTotal != null ? fmt(h.medianTotal) : "–"}</td></tr>`;
  }).join("");
  return rows ? `<table><tr><th>Case</th><th>Riktig</th><th>Median</th><th>14 d</th></tr>${rows}</table>` : `<span class="muted small">Ingen data ennå.</span>`;
}
function renderPicker() {
  $("p-groups").innerHTML = `<button data-pg="alle">Alle</button><button data-pg="ingen">Ingen</button>` +
    Object.keys(PLL_GROUPS).map((g) => `<button data-pg="${g}">${g}</button>`).join("");
  $("p-picker").innerHTML = PLLS.map((c) => `<button class="case ${P.selection.has(c.name) ? "on" : ""}" data-pc="${c.name}" title="${c.exec}">
    <span class="n">${c.name}</span><span class="a">${c.exec}</span></button>`).join("");
}
function renderAlgs() {
  const f = (x) => (x != null ? fmt(x) : "–");
  $("p-algs").innerHTML = `<tr><th>PLL</th><th>Algoritme (fra din startvinkel)</th><th>Median 14 d</th><th>Godkjent</th></tr>` +
    PLLS.map((c) => { const h = P.hist[c.name] || {}; return `<tr><td><b>${c.name}</b></td><td class="mono">${c.exec}</td><td>${f(h.medianTotal)}</td><td>${h.attempts ? `${h.ok}/${h.attempts}` : "–"}</td></tr>`; }).join("");
}

// ---------- planblokker ----------
export function startBlock(b) {
  P.selection = new Set(b.cases.filter((n) => PLL_BY_NAME[n]));
  setMode(b.mode && MODE_NAME[b.mode] && b.mode !== "guided" ? b.mode : "drill", false);
  if (P.mode === "rad") { P.rad.n = b.n || 3; buildRad(); }
  const oneRound = !b.minutes && P.mode === "rad";
  const minutes = oneRound ? 0 : b.minutes || 5;
  const prev = minutes && ctx.progressFor ? ctx.progressFor(b.id) : 0; // fortsett der blokka slapp (samme dag)
  P.block = { id: b.id, name: b.name, minutes, end: oneRound ? Infinity : performance.now() + minutes * 60000 - prev, lastProgress: performance.now() };
  if (prev && ctx.mmss) setTimeout(() => flash(`Fortsetter på ${ctx.mmss(prev)}`), 50);
  log({ event: "block-start", block: b.id, minutes: b.minutes, cases: b.cases, mode: P.mode, trainer: "pll" });
  renderPicker();
  startCase();
}
function blockTick() {
  if (!P.block) return;
  const left = P.block.end - (P.block.pausedAt || performance.now());
  const el = $("p-blocktimer");
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  if (el) el.textContent = (P.block.pausedAt ? "⏸ " : "") + (!isFinite(left) ? `${Math.min(P.rad.idx + 1, P.rad.queue.length)}/${P.rad.queue.length}` : left > 0 ? mmss(left) : "+" + mmss(-left));
  if (!P.block.pausedAt && P.block.minutes && performance.now() - P.block.lastProgress >= 30000) { P.block.lastProgress = performance.now(); progressLog(); }
  // Tiden ute: blokken går på overtid til du avslutter selv.
  if (left <= 0 && !P.block.warned) { P.block.warned = true; ctx.beep(3); flash("Tiden er ute – fortsett eller avslutt"); }
}
function elapsedOf(b) {
  if (!b || !b.minutes || !isFinite(b.end)) return null;
  return Math.max(0, Math.round(b.minutes * 60000 - (b.end - (b.pausedAt || performance.now()))));
}
function progressLog() {
  const elapsed = elapsedOf(P.block);
  if (elapsed == null) return;
  log({ event: "block-progress", block: P.block.id, elapsed, trainer: "pll" });
  if (ctx.onProgress) ctx.onProgress({ kind: "progress", block: P.block.id, t: new Date().toISOString(), elapsed });
}
function togglePause() {
  if (!P.block) return;
  if (P.block.pausedAt) {
    P.block.end += performance.now() - P.block.pausedAt; P.block.pausedAt = null; flash("Fortsetter");
    if (P.phase === "case" && P.cur) { startCase(true); return; }
  } else { P.block.pausedAt = performance.now(); progressLog(); flash("Pause"); }
  render();
}
setInterval(() => { if (active && P.block) blockTick(); }, 500);
function endBlock() {
  if (!P.block) return;
  log({ event: "block-end", block: P.block.id, trainer: "pll", elapsed: elapsedOf(P.block) });
  flush();
  const { id, name } = P.block;
  P.block = null;
  if (ctx.onBlockDone) ctx.onBlockDone(id);
  loadHist();
  P.phase = "idle"; P.cur = null;
  render();
  $("p-phase").innerHTML = `<div class="big">«${name}» ferdig. Velg neste blokk.</div>`;
}

// ---------- oppkobling ----------
function setMode(m, start = true) {
  if (m === "guided") { if (P.mode !== "guided") P.baseMode = P.mode; P.mode = "guided"; }
  else { P.mode = P.baseMode = m; }
  P.repeat = null;
  if (m === "rad") buildRad();
  if (start) startCase();
}
async function loadHist() {
  try {
    const r = await fetch(LOG_URL.replace(/\/api\/log$/, "/api/stats?days=14"));
    if (r.ok) { const j = await r.json(); P.hist = (j.trainers && j.trainers.pll) || {}; }
  } catch (e) { /* bare økta */ }
  if (active) render();
}
let active = false;
export function init(c) {
  ctx = c;
  document.querySelectorAll("[data-pmode]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.pmode;
    if (m === "guided" && P.mode === "guided") { P.mode = P.baseMode; P.repeat = null; startCase(); }
    else if (m !== P.mode) setMode(m);
  }));
  $("p-rad-n").addEventListener("change", (e) => { P.rad.n = +e.target.value; P.rad.streak = 0; render(); });
  $("p-colorswap").addEventListener("change", (e) => { P.colorSwap = e.target.checked; });
  $("p-toggle-picker").addEventListener("click", () => { $("p-picker-wrap").hidden = !$("p-picker-wrap").hidden; renderPicker(); });
  $("p-toggle-algs").addEventListener("click", () => { $("p-algs-wrap").hidden = !$("p-algs-wrap").hidden; renderAlgs(); });
  $("p-groups").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pg]"); if (!b) return;
    const g = b.dataset.pg;
    if (g === "alle") P.selection = new Set(PLLS.map((c) => c.name));
    else if (g === "ingen") P.selection.clear();
    else P.selection = new Set(PLL_GROUPS[g]);
    if (P.mode === "rad") buildRad();
    renderPicker(); startCase();
  });
  $("p-picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pc]"); if (!b) return;
    const n = b.dataset.pc;
    P.selection.has(n) ? P.selection.delete(n) : P.selection.add(n);
    if (P.mode === "rad") buildRad();
    renderPicker(); if (P.phase === "idle" || !P.selection.has(P.cur && P.cur.c.name)) startCase(); else render();
  });
  $("p-calib").addEventListener("click", () => { if (window.acubemy) acubemy.calibrateGyro(); });
  $("p-retry").addEventListener("click", () => { if (P.cur) startCase(true); });
  $("p-skip").addEventListener("click", () => { P.repeat = null; if (P.mode === "rad") { P.rad.idx++; P.rad.streak = 0; } startCase(); });
  loadHist();
}
export function activate() {
  active = true;
  if (ctx.view3d) $("p-stage").appendChild(ctx.view3d.container);
  if (P.cur && P.phase === "case") {
    if (ctx.view3d) { ctx.view3d.setColorShift(P.cur.inst.colorShift); ctx.view3d.set(P.cur.state, false); }
    render(); tick();
  } else startCase();
}
export function deactivate() { if (P.block) endBlock(); active = false; }
export const isActive = () => active;
