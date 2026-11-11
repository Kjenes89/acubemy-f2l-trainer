import { SOLVED, OPPOSITE, turn, f2lSolved } from "./cube.js";
import { expand, invert, simplify, canonical, heldNotation, gripNotation, sameGrip } from "./alg.js";
import { CASES, CASE_BY_N, DEFAULT_SELECTION, LL_SCRAMBLERS } from "./cases.js";
import { cubeSvg } from "./view.js";

let view3d = null;
const dimNow = () => true;

const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window;
const rnd = (n) => Math.floor(Math.random() * n);
const fmt = (ms) => (ms / 1000).toFixed(2);

const S = {
  facelets: SOLVED, // den VIRTUELLE kuben: casen lages her, og trekkene fra den fysiske kuben brukes på den
  mode: "drill", // drill | guided
  mixLL: true,
  colorSwap: true,
  selection: new Set(DEFAULT_SELECTION),
  phase: "idle", // idle (ingen caser valgt) | case | pause (kort pause mellom caser)
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
// Casens AUF = tilfeldig AUF slått sammen med U-trekkene algoritmen starter med (bokas «U2» o.l.).
// De U-tokenene skjules i algoritmelinja; AUF-en vises for seg, i parentes.
function withPreAuf(aufAmt, algMoves) {
  const moves = algMoves.map((m) => ({ ...m }));
  let amt = aufAmt;
  const hidden = new Set();
  while (moves.length && moves[0].face === "D") { amt += moves[0].amt; hidden.add(moves[0].tok); moves.shift(); }
  amt %= 4;
  return { items: amt ? [{ face: "D", amt, tok: -1, auf: true }, ...moves] : moves, hidden, aufAmt: amt };
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

// Ny case rett på den virtuelle kuben – den fysiske kuben trenger ikke settes opp.
function startCase(sameAgain = false) {
  const c = sameAgain && S.cur ? S.cur.c : pickCase();
  if (!c) { S.phase = "idle"; S.cur = null; render(); return; }
  let cur;
  if (sameAgain && S.cur) {
    cur = { ...S.cur };
  } else {
    const alg = expand(c.alg);
    const pre = S.mixLL ? [...expand(LL_SCRAMBLERS[rnd(LL_SCRAMBLERS.length)]).moves, { face: "D", amt: rnd(4) }] : [];
    const auf = rnd(4);
    const start = simplify([...pre, ...invert(alg.moves), { face: "D", amt: auf }]);
    cur = { c, alg, auf: (4 - auf) % 4, startState: start, colorShift: S.colorSwap ? rnd(4) : 0 };
  }
  S.facelets = simplify(cur.startState).reduce((st, m) => turn(st, m.face, m.amt), SOLVED);
  const { items, hidden, aufAmt } = withPreAuf(cur.auf, cur.alg.moves);
  Object.assign(cur, { guide: new Tracker(items), hidden, aufAmt, executed: [], snaps: [], recent: [], t0: performance.now(), firstMove: null });
  S.cur = cur;
  S.phase = "case";
  if (view3d) { view3d.setColorShift(cur.colorShift || 0); view3d.set(S.facelets, dimNow()); }
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
  if (S.mode === "guided") S.repeat = cur.c.n; // guidet: samme case til du går ut av guidet
  // Kort pause så siste trekk rekker å vises; trekk i pausen ignoreres.
  S.phase = "pause";
  render();
  setTimeout(() => startCase(), 350);
}

// ---------- trekk inn ----------
// Snarveier som i acubemy (fire like kvartdreiinger, farge = flate slik du holder kuben):
// gul (U4) = kalibrer gyro, hvit (D4) = prøv casen igjen, oransje (R4) = guidet av/på, rød (L4) = neste case.
const SHORTCUT = { D: "gyro", U: "retry", L: "guided", R: "next" }; // nøkkel = flate i kubens egen ramme
const SHORTCUT_MS = 1500;

function shortcut(kind) {
  if (kind === "gyro") {
    if (window.acubemy) acubemy.calibrateGyro();
    const snap = S.cur.snaps[S.cur.snaps.length - 4];
    if (snap) { S.cur.guide.items = snap.items; S.cur.executed.length = snap.exec; S.cur.recent = []; S.cur.snaps = []; }
    flash("Gyro kalibrert");
    render();
  } else if (kind === "retry") {
    flash("Samme case igjen");
    startCase(true);
  } else if (kind === "guided") {
    if (S.mode === "guided") { S.mode = "drill"; S.repeat = null; flash("Drill"); startCase(); }
    else { S.mode = "guided"; flash("Guidet"); startCase(true); }
  } else if (kind === "next") {
    S.repeat = null;
    flash("Neste case");
    startCase();
  }
}

function flash(text) {
  const el = $("flash");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove("on"), 900);
}

function onMove(face, a, ts) {
  if (S.phase !== "case") return;
  const cur = S.cur;
  cur.snaps.push({ items: cur.guide.items.map((m) => ({ ...m })), exec: cur.executed.length });
  if (cur.snaps.length > 4) cur.snaps.shift();
  const now = performance.now();
  cur.recent.push({ face, a, t: now });
  if (cur.recent.length > 4) cur.recent.shift();
  S.facelets = turn(S.facelets, face, a);
  if (view3d) view3d.move(face, a, S.facelets, dimNow());
  if (cur.firstMove == null) cur.firstMove = now;
  cur.executed.push({ face, amt: a });
  cur.guide.step(face, a);
  const r = cur.recent;
  if (r.length === 4 && r.every((m) => m.face === face && m.a === a) && now - r[0].t < SHORTCUT_MS && SHORTCUT[face]) {
    shortcut(SHORTCUT[face]);
    return;
  }
  if (f2lSolved(S.facelets)) finishCase(); else render();
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

// Notasjon slik du holder kuben nå (fra gyroen); uten gyro: slik algoritmen forutsetter.
function liveGrip() { return view3d ? view3d.grip() : null; }
function notate(m, fallbackGrip) {
  const g = liveGrip();
  return g ? gripNotation(m, g) : fallbackGrip ? gripNotation(m, fallbackGrip) : heldNotation(m);
}

function algHtml(cur, guided) {
  if (!guided) return "";
  const it = cur.guide.items;
  const head = it.find((m) => !m.corr);
  let msg = "";
  if (cur.guide.correcting) {
    const fixes = [];
    for (const m of it) { if (!m.corr) break; fixes.push(notate(m, head && head.grip)); }
    msg = `<div class="fix">Angre: ${chips(fixes, "bad")}</div>`;
  } else if (head) {
    const g = liveGrip();
    const book = head.grip ? gripNotation(head, head.grip) : notate(head);
    if (head.auf) {
      msg = `<div class="hint">Først AUF: <span class="mv now">${notate(head)}</span></div>`;
    } else if (g && head.grip && !sameGrip(g, head.grip)) {
      msg = `<div class="hint">Kuben står ikke rotert som i algoritmen. Slik du holder den nå: <span class="mv now">${gripNotation(head, g)}</span></div>`;
    } else {
      msg = `<div class="hint">Neste: <span class="mv now">${book}</span></div>`;
    }
  }
  return msg + algLine(cur, head);
}

function algLine(cur, head) {
  const toks = cur.alg.tokens;
  const nowTok = head ? head.tok : toks.length;
  const aufNow = head && head.auf;
  const auf = cur.aufAmt
    ? `<span class="mv auf ${aufNow ? "now" : "done"}">(${notate({ face: "D", amt: cur.aufAmt })})</span>`
    : "";
  const parts = toks.map((t, i) => {
    if (cur.hidden.has(i)) return "";
    const cls = !aufNow && i < nowTok ? "done" : !aufNow && i === nowTok ? "now" : "";
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
  if (S.phase === "idle") {
    main = `<div class="big">Velg minst én case.</div>`;
  } else if (S.phase === "case" || S.phase === "pause") {
    const guided = S.mode === "guided";
    main = `<div class="caseinfo"><b>${cur.c.n}</b> <span class="muted">bok ${cur.c.bookNo} · s. ${cur.c.bookPage} · ${cur.c.source}</span></div>
      ${view3d ? "" : `<div class="cube">${cubeSvg(S.facelets)}</div>`}
      <div id="timer" class="timer">${S.phase === "pause" && S.last ? fmt(S.last.time) : "0.00"}</div>
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
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    const was = S.mode;
    S.mode = b.dataset.mode;
    if (was === "guided" && S.mode === "drill") S.repeat = null; // tilbake til vanlig utvalg etter denne casen
    if (was === "drill" && S.mode === "guided" && S.cur) { startCase(true); return; }
    render();
  }));
  $("mixll").addEventListener("change", (e) => { S.mixLL = e.target.checked; });
  $("colorswap").addEventListener("change", (e) => { S.colorSwap = e.target.checked; });
  $("toggle-picker").addEventListener("click", () => { $("picker-wrap").hidden = !$("picker-wrap").hidden; renderPicker(); });
  $("picker").addEventListener("click", (e) => {
    const b = e.target.closest(".case"); if (!b) return;
    const n = +b.dataset.n;
    S.selection.has(n) ? S.selection.delete(n) : S.selection.add(n);
    renderPicker(); if (S.phase === "idle") startCase(); else render();
  });
  $("sel-all").addEventListener("click", () => { CASES.forEach((c) => S.selection.add(c.n)); renderPicker(); if (S.phase === "idle") startCase(); else render(); });
  $("sel-none").addEventListener("click", () => { S.selection.clear(); renderPicker(); render(); });
  $("sel-asker").addEventListener("click", () => { S.selection = new Set(DEFAULT_SELECTION); renderPicker(); if (S.phase === "idle") startCase(); else render(); });
  $("calib").addEventListener("click", () => { if (window.acubemy) acubemy.calibrateGyro(); });
  $("skip").addEventListener("click", () => { S.repeat = null; startCase(); });
  $("retry").addEventListener("click", () => { if (S.cur) startCase(true); });
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
    acubemy.onGyro((q) => {
      if (!view3d) return;
      view3d.setGyro(q);
      // Guidet: oppdater hintet når du roterer kuben (uten å vente på et trekk).
      if (S.mode === "guided" && S.phase === "case") {
        requestAnimationFrame(() => {
          const g = view3d.grip();
          const k = g ? g.U + g.F : "";
          if (k !== S.gripKey) { S.gripKey = k; render(); }
        });
      }
    });
    acubemy.onMove(({ face, prime, timestamp }) => onMove(face, prime ? 3 : 1, timestamp));
  }
  if (!embedded) $("device").textContent = "Utenfor acubemy: tastene U R F D L B (Shift = mot klokka) simulerer kuben i kubens egen ramme";
  window.__sim = (mv) => { const f = mv[0]; const a = mv.includes("2") ? 2 : mv.includes("'") ? 3 : 1; for (let i = 0; i < (a === 2 ? 2 : 1); i++) onMove(f, a === 2 ? 1 : a, performance.now()); };
  window.__state = S;
  startCase();
}

boot();
