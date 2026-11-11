import { SOLVED, OPPOSITE, turn, f2lSolved } from "./cube.js";
import { expand, invert, simplify, canonical, heldNotation, gripNotation, sameGrip, yNeeded, START_GRIP } from "./alg.js";
import { CASES, CASE_BY_N, DEFAULT_SELECTION, LL_SCRAMBLERS } from "./cases.js";
import { cubeSvg } from "./view.js";

let view3d = null;
const dimNow = () => true;

const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window;
const rnd = (n) => Math.floor(Math.random() * n);
const fmt = (ms) => (ms / 1000).toFixed(2);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const RING = ["F", "L", "B", "R"];
const colorMapFor = (k) => Object.fromEntries(RING.map((c, i) => [c, RING[(i + k) % 4]]));

const S = {
  facelets: SOLVED, // den VIRTUELLE kuben: casen lages her, og trekkene fra den fysiske kuben brukes på den
  mode: "drill", // drill | guided
  mixLL: true,
  colorSwap: true,
  selection: new Set(DEFAULT_SELECTION),
  phase: "idle", // idle | case | result (resultatvindu; U for neste)
  cur: null,
  last: null,
  repeat: null,
  attempts: { n: null, count: 0 },
  stats: {}, // per case: { reps, ok, exec: [], rec: [] } – exec/rec bare for drill med valgt løsning
  resultRecent: [],
};

// ---------- sporing av forventet trekkrekke ----------
class Tracker {
  constructor(items) { this.items = items.map((m) => ({ ...m })); }
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
    it.unshift({ face, amt: (4 - a) % 4, corr: true });
    return false;
  }
}

// Casens AUF = tilfeldig AUF slått sammen med U-trekkene algoritmen starter med (bokas «U2» o.l.).
function withPreAuf(aufAmt, algMoves) {
  const moves = algMoves.map((m) => ({ ...m }));
  let amt = aufAmt;
  const hidden = new Set();
  while (moves.length && moves[0].face === "D") { amt += moves[0].amt; hidden.add(moves[0].tok); moves.shift(); }
  amt %= 4;
  return { items: amt ? [{ face: "D", amt, tok: -1, auf: true }, ...moves] : moves, hidden, aufAmt: amt };
}

// ---------- casevalg ----------
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
  hideOverlay();
  if (!c) { S.phase = "idle"; S.cur = null; render(); return; }
  let cur;
  if (sameAgain && S.cur) {
    cur = { c: S.cur.c, alg: S.cur.alg, auf: S.cur.auf, startState: S.cur.startState, colorShift: S.cur.colorShift };
  } else {
    const alg = expand(c.alg);
    const pre = S.mixLL ? [...expand(LL_SCRAMBLERS[rnd(LL_SCRAMBLERS.length)]).moves, { face: "D", amt: rnd(4) }] : [];
    const auf = rnd(4);
    const start = simplify([...pre, ...invert(alg.moves), { face: "D", amt: auf }]);
    cur = { c, alg, auf: (4 - auf) % 4, startState: start, colorShift: S.colorSwap ? rnd(4) : 0 };
  }
  if (S.attempts.n !== c.n) S.attempts = { n: c.n, count: 0 };
  S.facelets = simplify(cur.startState).reduce((st, m) => turn(st, m.face, m.amt), SOLVED);
  // Starttilstanden med alle fire AUF-er: kommer kuben tilbake hit, nullstilles tiden (som i acubemy).
  cur.startSet = new Set([0, 1, 2, 3].map((k) => turn(S.facelets, "D", k)));
  const { items, hidden, aufAmt } = withPreAuf(cur.auf, cur.alg.moves);
  Object.assign(cur, {
    guide: new Tracker(items), hidden, aufAmt, executed: [], snaps: [], recent: [],
    t0: performance.now(), execStart: null, execIdx: 0,
  });
  S.cur = cur;
  S.phase = "case";
  if (view3d) { view3d.setColorShift(cur.colorShift || 0); view3d.set(S.facelets, dimNow()); }
  render();
  tick();
}

function finishCase() {
  const cur = S.cur;
  const end = performance.now();
  const execStart = cur.execStart ?? end;
  const rec = execStart - cur.t0;
  const exec = end - execStart;
  const did = canonical(cur.executed);
  const accepted = [cur.c.alg, ...cur.c.alts].map((a) => canonical(expand(a).moves));
  const ok = accepted.includes(did);
  const quarters = (ms) => simplify(ms).filter((m) => m.face !== "D").reduce((s, m) => s + (m.amt === 2 ? 2 : 1), 0);
  const rawQ = cur.executed.filter((m) => m.face !== "D").length;
  const fixed = ok && rawQ > quarters(cur.alg.moves);
  const execMoves = simplify(cur.executed.slice(cur.execIdx)).length;
  const guided = S.mode === "guided";
  const st = (S.stats[cur.c.n] ||= { reps: 0, ok: 0, exec: [], rec: [] });
  const prevMedian = median(st.exec);
  st.reps++;
  if (ok) { st.ok++; if (!guided) { st.exec.push(exec); st.rec.push(rec); } }
  S.attempts.count++;
  S.last = {
    n: cur.c.n, ok, fixed, guided, rec, exec, total: rec + exec,
    tps: exec > 0 ? execMoves / (exec / 1000) : 0,
    median: median(st.exec), prevMedian, attempts: S.attempts.count,
    did: didInYourGrip(cur.executed),
  };
  S.repeat = ok ? null : cur.c.n;
  if (guided) S.repeat = cur.c.n; // guidet: samme case til du går ut av guidet
  if (guided) {
    // Mengdetrening: ingen resultatvindu, samme case igjen straks siste trekk er vist.
    flash(ok ? `${fmt(exec)} ✓` : "Annen løsning");
    S.phase = "pause";
    render();
    setTimeout(() => { if (S.phase === "pause") startCase(true); }, 300);
    return;
  }
  S.phase = "result";
  S.resultRecent = [];
  render();
  showOverlay();
}

// ---------- snarveier ----------
// Fire like kvartdreiinger innen 1,5 s. Farge = flate slik kuben holdes (hvit ned, grønn foran).
// Under casen: gul U4 kalibrer gyro · hvit D4 samme case · oransje R4 guidet av/på · rød L4 neste case.
// I resultatvinduet (som acubemy): U = neste (eller samme igjen ved feil) · rød L4 = gjenta · oransje R4 = guidet.
const CASE_SHORTCUT = { D: "gyro", U: "retry", L: "guided", R: "next" }; // nøkkel = flate i kubens egen ramme
const SHORTCUT_MS = 1500;

function fourInRow(list, face, a, now) {
  return list.length === 4 && list.every((m) => m.face === face && m.a === a) && now - list[0].t < SHORTCUT_MS;
}

function toggleGuided() {
  if (S.mode === "guided") { S.mode = "drill"; S.repeat = null; flash("Drill"); startCase(); }
  else { S.mode = "guided"; flash("Guidet"); startCase(true); }
}

function shortcut(kind) {
  if (kind === "gyro") {
    if (window.acubemy) acubemy.calibrateGyro();
    const snap = S.cur.snaps[S.cur.snaps.length - 4];
    if (snap) {
      S.cur.guide.items = snap.items; S.cur.executed.length = snap.exec;
      S.cur.execStart = snap.execStart; S.cur.execIdx = snap.execIdx;
    }
    S.cur.recent = []; S.cur.snaps = [];
    flash("Gyro kalibrert");
    render();
  } else if (kind === "retry") { flash("Samme case igjen"); startCase(true); }
  else if (kind === "guided") toggleGuided();
  else if (kind === "next") { S.repeat = null; flash("Neste case"); startCase(); }
}

function flash(text) {
  const el = $("flash");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove("on"), 900);
}

// ---------- trekk inn ----------
function onMove(face, a) {
  const now = performance.now();
  if (S.phase === "result") {
    // Gul (U, kubens D) = videre. Rød L4 = gjenta samme case. Oransje R4 = guidet.
    S.resultRecent.push({ face, a, t: now });
    if (S.resultRecent.length > 4) S.resultRecent.shift();
    if (face === "D") { startCase(); return; }
    if (fourInRow(S.resultRecent, face, a, now)) {
      if (face === "R") { flash("Gjenta"); startCase(true); }
      else if (face === "L") toggleGuided();
    }
    return;
  }
  if (S.phase !== "case") return;
  const cur = S.cur;
  cur.snaps.push({ items: cur.guide.items.map((m) => ({ ...m })), exec: cur.executed.length, execStart: cur.execStart, execIdx: cur.execIdx });
  if (cur.snaps.length > 4) cur.snaps.shift();
  cur.recent.push({ face, a, t: now });
  if (cur.recent.length > 4) cur.recent.shift();
  S.facelets = turn(S.facelets, face, a);
  if (view3d) view3d.move(face, a, S.facelets, dimNow());
  cur.executed.push({ face, amt: a, grip: liveGrip() });
  cur.guide.step(face, a);
  // Tiden starter ved første trekk som ikke er U (AUF), og nullstilles hvis kuben er tilbake i casen.
  if (cur.execStart == null && face !== "D") { cur.execStart = now; cur.execIdx = cur.executed.length - 1; }
  else if (cur.execStart != null && cur.startSet.has(S.facelets)) { cur.execStart = null; }
  if (fourInRow(cur.recent, face, a, now) && CASE_SHORTCUT[face]) { shortcut(CASE_SHORTCUT[face]); return; }
  if (f2lSolved(S.facelets)) finishCase(); else render();
}

// ---------- visning ----------
function tick() {
  if (S.phase !== "case") return;
  const el = $("timer");
  if (el) el.textContent = S.cur.execStart != null ? fmt(performance.now() - S.cur.execStart) : "0.00";
  requestAnimationFrame(tick);
}

const chips = (list, cls = "") => list.map((t) => `<span class="mv ${cls}">${t}</span>`).join("");

function liveGrip() { return view3d ? view3d.grip() : null; }
function notate(m, fallbackGrip) {
  const g = liveGrip();
  return g ? gripNotation(m, g) : fallbackGrip ? gripNotation(m, fallbackGrip) : heldNotation(m);
}

// Påminnelse (begge moduser) før utførelsen starter: står kuben rotert fra forrige case?
function rotateReminder(cur) {
  const g = liveGrip();
  if (!g || cur.execStart != null) return "";
  const need = yNeeded(g, START_GRIP);
  if (need === "") return "";
  if (S.mode === "guided") {
    const head = cur.guide.items.find((m) => !m.corr);
    if (head && !head.auf) return ""; // guidet viser rotasjonen i algoritmelinja i stedet
  }
  return `<div class="remind">${need ? `Roter tilbake: <span class="mv now">${need}</span>` : "Hold kuben med hvit ned og grønn foran"}</div>`;
}

function algHtml(cur) {
  const it = cur.guide.items;
  const head = it.find((m) => !m.corr);
  const g = liveGrip();
  let msg = "", rotNow = null;
  if (cur.guide.correcting) {
    const fixes = [];
    for (const m of it) { if (!m.corr) break; fixes.push(notate(m, head && head.grip)); }
    msg = `<div class="fix">Angre: ${chips(fixes, "bad")}</div>`;
  } else if (head && head.auf) {
    msg = `<div class="hint">Først AUF: <span class="mv now">${notate(head)}</span></div>`;
  } else if (head) {
    const need = g && head.grip ? yNeeded(g, head.grip) : "";
    if (need) {
      rotNow = need;
      msg = `<div class="hint">Roter: <span class="mv now">${need}</span> <span class="muted small">(eller ta trekket uten rotasjon: ${gripNotation(head, g)})</span></div>`;
    } else if (need === null) {
      msg = `<div class="hint">Slik du holder kuben nå: <span class="mv now">${gripNotation(head, g)}</span></div>`;
    } else {
      msg = `<div class="hint">Neste: <span class="mv now">${gripNotation(head, head.grip || START_GRIP)}</span></div>`;
    }
  }
  return msg + algLine(cur, head, rotNow);
}

// Algoritmelinja: AUF i parentes; en rotasjon lyser til kuben faktisk er rotert (gyro).
function algLine(cur, head, rotNow) {
  const toks = cur.alg.tokens;
  const nowTok = head ? head.tok : toks.length;
  const aufNow = head && head.auf;
  // Rotasjonstokener rett før neste trekk.
  const rotToks = new Set();
  if (rotNow && head && !aufNow) for (let i = nowTok - 1; i >= 0 && /^[xyz]/.test(toks[i]); i--) rotToks.add(i);
  const auf = cur.aufAmt ? `<span class="mv auf ${aufNow ? "now" : "done"}">(${notate({ face: "D", amt: cur.aufAmt })})</span>` : "";
  const parts = toks.map((t, i) => {
    if (cur.hidden.has(i)) return "";
    let cls = "";
    if (!aufNow) {
      if (rotToks.size) cls = rotToks.has(i) ? "now" : i < Math.min(...rotToks) ? "done" : "";
      else cls = i < nowTok ? "done" : i === nowTok ? "now" : "";
    }
    return `<span class="mv ${cls}">${t}</span>`;
  }).join("");
  return `<div class="alg">${auf}${parts}</div>`;
}

function caseCard(cur) {
  const st = S.stats[cur.c.n];
  const best = st && st.exec.length ? fmt(Math.min(...st.exec)) : "–";
  const med = st && st.exec.length ? fmt(median(st.exec)) : "–";
  const svg = cubeSvg(simplify(cur.startState).reduce((s, m) => turn(s, m.face, m.amt), SOLVED), { colorMap: colorMapFor(cur.colorShift || 0) });
  return `<div class="gc-head"><span class="muted small">GUIDET</span><b>F2L ${cur.c.n}</b></div>
    <div class="gc-cube">${svg}</div>
    <div class="muted small">FR-spor · bok ${cur.c.bookNo}, s. ${cur.c.bookPage} · ${cur.c.source}</div>
    <div class="gc-alg">${cur.c.alg}</div>
    <div class="gc-stats"><div><span class="muted small">Beste (drill)</span><b>${best}</b></div><div><span class="muted small">Median</span><b>${med}</b></div></div>`;
}

// Det du gjorde, skrevet slik du holdt kuben (grep fra gyroen ved hvert trekk), med rotasjonene du tok.
function didInYourGrip(executed) {
  if (!executed.length || executed.some((m) => !m.grip)) return null;
  const out = [];
  let grip = START_GRIP;
  for (const m of executed) {
    if (!sameGrip(m.grip, grip)) {
      const r = yNeeded(grip, m.grip);
      out.push({ rot: r == null ? "(rotert)" : r });
      grip = m.grip;
    }
    const f = Object.keys(grip).find((k) => grip[k] === m.face);
    const last = out[out.length - 1];
    if (last && last.face === f) { last.amt = (last.amt + m.amt) % 4; if (!last.amt) out.pop(); }
    else out.push({ face: f, amt: m.amt });
  }
  return out.map((t) => t.rot ?? t.face + (t.amt === 2 ? "2" : t.amt === 3 ? "'" : "")).join(" ");
}

// ---------- resultatvindu ----------
function showOverlay() {
  const r = S.last, c = CASE_BY_N[r.n];
  const el = $("overlay");
  const diff = r.prevMedian != null && r.median != null ? r.median - r.prevMedian : null;
  const diffHtml = diff == null || !r.ok || r.guided ? "" : `<span class="diff ${diff <= 0 ? "down" : "up"}">${diff <= 0 ? "−" : "+"}${fmt(Math.abs(diff))}</span>`;
  const stats = `<div class="o-grid">
      <div class="o-box wide"><span>Median</span><b>${r.median != null ? fmt(r.median) : "–"} ${diffHtml}</b></div>
      <div class="o-box"><span>Gjenkjenning</span><b>${fmt(r.rec)}</b></div>
      <div class="o-box"><span>TPS</span><b>${r.tps.toFixed(1)}</b></div>
      <div class="o-box"><span>Forsøk</span><b>${r.attempts}</b></div>
    </div>`;
  if (r.ok) {
    el.className = "on good";
    el.innerHTML = `<div class="o-dot"></div><div class="o-time">${fmt(r.exec)}</div>${stats}
      <div class="o-badge">✓ ${r.fixed ? "Valgt løsning (med retting)" : "Valgt løsning"}${r.guided ? " · guidet" : ""}</div>
      <div class="o-keys"><span>Gjenta <kbd>L4</kbd></span><span class="next">${r.guided ? "Samme case" : "Neste"} <kbd>U</kbd></span></div>`;
  } else {
    el.className = "on bad";
    el.innerHTML = `<div class="o-title">Annen løsning</div>
      <div class="o-cmp">${r.did ? `<div><span>Du gjorde</span><code>${r.did}</code></div>` : ""}
      <div><span>Skal være</span><code class="big">${c.alg}</code></div></div>
      <div class="o-keys"><span>Guidet <kbd>R4</kbd></span><span class="next">Prøv igjen <kbd>U</kbd></span></div>`;
  }
}
function hideOverlay() { $("overlay").className = ""; }

function sidebarResult() {
  const r = S.last;
  if (!r) return `<p class="muted">Ingen caser løst ennå.</p>`;
  const c = CASE_BY_N[r.n];
  return `<div class="res">
    <div class="resrow"><b>${c.n}</b><span class="muted">bok ${c.bookNo}, s. ${c.bookPage}</span><span class="t">${fmt(r.exec)}</span></div>
    <div>${r.ok ? `<span class="good">Valgt løsning${r.fixed ? " (med retting)" : ""}</span>` : `<span class="badtxt">Annen løsning</span>`}${r.guided ? ' <span class="muted">(guidet)</span>' : ""}</div>
    <div class="muted">Gjenkjenning ${fmt(r.rec)} · utførelse ${fmt(r.exec)} · sum ${fmt(r.total)}</div>
  </div>`;
}

function statsHtml() {
  const rows = CASES.filter((c) => S.stats[c.n]).map((c) => {
    const s = S.stats[c.n];
    const m = median(s.exec), mr = median(s.rec);
    return `<tr><td>${c.n}</td><td>${c.bookNo}</td><td>${s.ok}/${s.reps}</td><td>${mr != null ? fmt(mr) : "–"}</td><td>${m != null ? fmt(m) : "–"}</td><td>${s.exec.length ? fmt(Math.min(...s.exec)) : "–"}</td></tr>`;
  }).join("");
  if (!rows) return "";
  return `<table><thead><tr><th>case</th><th>bok</th><th>valgt</th><th>gjenk.</th><th>utf.</th><th>beste</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="muted small">Median gjenkjenning og utførelse, bare drill med valgt løsning. Utførelse måles fra første trekk som ikke er U. Lagres ikke ennå (M2).</p>`;
}

function render() {
  const cur = S.cur;
  const guided = S.mode === "guided";
  let main = "";
  if (S.phase === "idle") {
    main = `<div class="big">Velg minst én case.</div>`;
  } else {
    const timer = (S.phase === "result" || S.phase === "pause") && S.last ? fmt(S.last.exec) : cur.execStart != null ? fmt(performance.now() - cur.execStart) : "0.00";
    main = `${view3d ? "" : `<div class="cube">${cubeSvg(S.facelets, { colorMap: colorMapFor(cur.colorShift || 0) })}</div>`}
      <div id="timer" class="timer">${timer}</div>
      ${S.phase === "case" ? rotateReminder(cur) : ""}
      ${guided && S.phase === "case" ? algHtml(cur) : ""}`;
  }
  $("phase").innerHTML = main;
  $("main").classList.toggle("guided", guided && !!cur);
  $("gcard").innerHTML = guided && cur ? caseCard(cur) : "";
  if (view3d && S.phaseShown !== S.phase) { S.phaseShown = S.phase; view3d.redim(dimNow()); }
  $("result").innerHTML = sidebarResult();
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
    if (b.dataset.mode === S.mode) return;
    toggleGuided();
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
      // Oppdater hint/påminnelse når kuben roteres, uten å vente på et trekk.
      if (S.phase === "case") {
        requestAnimationFrame(() => {
          const g = view3d.grip();
          const k = g ? g.U + g.F : "";
          if (k !== S.gripKey) { S.gripKey = k; render(); }
        });
      }
    });
    acubemy.onMove(({ face, prime }) => onMove(face, prime ? 3 : 1));
  }
  if (!embedded) $("device").textContent = "Utenfor acubemy: tastene U R F D L B (Shift = mot klokka) simulerer kuben i kubens egen ramme";
  window.__sim = (mv) => { const f = mv[0]; const a = mv.includes("2") ? 2 : mv.includes("'") ? 3 : 1; for (let i = 0; i < (a === 2 ? 2 : 1); i++) onMove(f, a === 2 ? 1 : a); };
  window.__state = S;
  startCase();
}

boot();
