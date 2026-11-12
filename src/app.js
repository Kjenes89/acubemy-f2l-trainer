import { SOLVED, turn, f2lSolved } from "./cube.js";
import { expand, invert, simplify, heldNotation, gripNotation, yNeeded, START_GRIP } from "./alg.js";
import { CASES, CASE_BY_N, DEFAULT_SELECTION, LL_SCRAMBLERS, SLOTS, variant, INTRODUCED } from "./cases.js";
import { cubeSvg } from "./view.js";
import * as PLL from "./pll.js";
import { log, flush, onStatus, LOG_URL, setPin, hasPin } from "./log.js";
import { Tracker, withPreAuf, sameSolution, didInYourGrip } from "./solve.js";
import { judgePair, crossSolved, solvedSlots, makeCrossScramble, makeTargetScramble, moveName, heldName, SENSOR_SLOTS } from "./slowsolve.js";

let view3d = null;
const dimNow = () => S.trainer === "f2l" && S.mode !== "slow"; // slow solve og PLL viser hele kuben

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
  trainer: "f2l", // f2l | pll (PLL-treneren ligger i pll.js og bruker samme 3D-kube)
  facelets: SOLVED, // den VIRTUELLE kuben: casen lages her, og trekkene fra den fysiske kuben brukes på den
  // drill (tilfeldig) | learn (én ny case om gangen) | recap (hver case N ganger) | weighted (svake oftere)
  // | rad (N riktige på rad per case) | guided (algoritmen trekk for trekk)
  mode: "drill",
  baseMode: "drill", // modusen du går tilbake til fra guidet
  rad: { n: 3, order: "weakest", queue: [], idx: 0, streak: 0 },
  learn: { threshold: 4.0, meanOf: 3, newChance: 50, learned: new Set(), recent: {}, intro: new Set() },
  recap: { repeat: 2, instant: false, order: "random", queue: [], idx: 0, times: {} },
  weighted: { strength: 2 },
  // Gjenkjenning og Predict: fast bilde (ingen gyro, ingen guiding) – ren gjenkjenning, som i solved.no.
  recog: { sub: "auf", options: 4, images: false, round: null, results: [], combo: 0, best: 0 },
  predict: { sub: "predict", view: "pair", tps: 3, round: null, results: [], combo: 0, best: 0 },
  review: { idx: 0, inst: null, timer: null },
  // Slow solve: scramble på den FYSISKE kuben, vanlig løsning, hvert F2L-par vurderes mot avtalt løsning.
  slow: { end: "f2l", phase: "scramble", no: 0, scramble: [], tracker: null, pairs: [], seg: null, solved: new Set(),
    f2l: false, corr: null, wrong: null, note: null, last: null, pending: null, lastBefore: null, lag: { pre: 0, post: 0 } },
  hist: {}, // per case fra loggen (Worker /api/stats): medianTotal, attempts, ok
  mixLL: true,
  colorSwap: true,
  selection: new Set(DEFAULT_SELECTION),
  slots: new Set(["FR"]), // spor casene kan komme i; bare caser med avtalt løsning i et valgt spor er med
  phase: "idle", // idle | case | result (resultatvindu; U for neste)
  cur: null,
  last: null,
  repeat: null,
  attempts: { n: null, count: 0 },
  stats: {}, // per case: { reps, ok, exec: [], rec: [] } – exec/rec bare for drill med valgt løsning
  resultRecent: [],
  plan: null, // fra plans/plan.json i repoet (Claude legger inn dagens blokker)
  block: null, // { id, name, end, minutes } når en planblokk kjører
  blocksDone: new Set(),
};

// ---------- casevalg ----------
// Hvor svak er en case? Median gjenkjenning + utførelse (økta, ellers loggen), straffet for avviste forsøk.
// Caser uten godkjente forsøk regnes som svakest.
function weakness(n) {
  const st = S.stats[n], h = S.hist[n];
  const sess = st && st.exec.length ? median(st.exec.map((e, i) => e + st.rec[i])) : null;
  const tot = sess ?? (h && h.medianTotal);
  if (tot == null) return Infinity;
  const att = (st ? st.reps : 0) + (h ? h.attempts : 0), ok = (st ? st.ok : 0) + (h ? h.ok : 0);
  return tot * (1 + (att ? 1 - ok / att : 0));
}

function buildRadQueue() {
  const cases = selected();
  if (S.rad.order === "weakest") cases.sort((a, b) => weakness(b) - weakness(a));
  else if (S.rad.order === "random") cases.sort(() => Math.random() - 0.5);
  S.rad.queue = cases; S.rad.idx = 0; S.rad.streak = 0;
}

// --- Learn (som solved): én ny case om gangen; lært når snittet av de siste N (gjenkjenning + utførelse) er under terskelen.
const availSlots = (n) => SLOTS.filter((sl) => S.slots.has(sl) && variant(n, sl));
const selected = () => CASES.map((c) => c.n).filter((n) => S.selection.has(n) && availSlots(n).length);
// Casen i ett av de valgte sporene (tilfeldig blant dem som har avtalt løsning).
function variantFor(n) { const sl = availSlots(n); return sl.length ? variant(n, sl[rnd(sl.length)]) : null; }
function learnInit() {
  const L = S.learn;
  L.learned = new Set();
  for (const n of selected()) {
    const h = S.hist[n];
    const last = h && h.lastTotals ? h.lastTotals.slice(-L.meanOf) : [];
    if (last.length >= L.meanOf && last.reduce((a, b) => a + b, 0) / last.length <= L.threshold * 1000) L.learned.add(n);
    L.recent[n] = last.slice();
  }
}
function learnCurrent() { return selected().find((n) => !S.learn.learned.has(n)) ?? null; }
function pickLearn() {
  const cur = learnCurrent();
  const known = selected().filter((n) => S.learn.learned.has(n));
  if (cur == null) return CASE_BY_N[known[rnd(known.length)]] || null;
  if (!known.length || Math.random() * 100 < S.learn.newChance) return CASE_BY_N[cur];
  return CASE_BY_N[known[rnd(known.length)]];
}
function learnRecord(n, ok, total) {
  const L = S.learn;
  if (!ok) { L.recent[n] = []; return; } // en avvist løsning nullstiller
  (L.recent[n] ||= []).push(total);
  const last = L.recent[n].slice(-L.meanOf);
  if (!L.learned.has(n) && last.length >= L.meanOf && last.reduce((a, b) => a + b, 0) / last.length <= L.threshold * 1000) {
    L.learned.add(n);
    flash(`Lært: F2L ${n}`);
  }
}

// --- Recap (som solved): hver valgte case N ganger, etter hverandre eller i runder; sammendrag til slutt.
function buildRecap() {
  const R = S.recap, cases = selected();
  if (R.order === "random") cases.sort(() => Math.random() - 0.5);
  R.queue = R.instant ? cases.flatMap((n) => Array(R.repeat).fill(n)) : Array.from({ length: R.repeat }, () => cases).flat();
  if (!R.instant && R.order === "random") { // stokk hver runde for seg, men unngå samme case to ganger på rad
    R.queue = [];
    for (let i = 0; i < R.repeat; i++) {
      let round = cases.slice().sort(() => Math.random() - 0.5);
      if (R.queue.length && round[0] === R.queue[R.queue.length - 1] && round.length > 1) round.push(round.shift());
      R.queue.push(...round);
    }
  }
  R.idx = 0; R.times = {};
}

// --- Weighted (som solved): sannsynlighet etter hvor svak casen er.
function pickWeighted() {
  const cases = selected();
  if (!cases.length) return null;
  const w = cases.map((n) => weakness(n));
  const finite = w.filter(isFinite), max = finite.length ? Math.max(...finite) : 1;
  const avoid = S.cur ? S.cur.c.n : null;
  const weights = w.map((x, i) => (cases.length > 1 && cases[i] === avoid ? 0 : Math.pow((isFinite(x) ? x : max * 1.5) / max, S.weighted.strength)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cases.length; i++) { r -= weights[i]; if (r <= 0) return CASE_BY_N[cases[i]]; }
  return CASE_BY_N[cases[cases.length - 1]];
}

function pickCase() {
  if (S.repeat && selected().includes(S.repeat)) return CASE_BY_N[S.repeat];
  if (S.mode === "learn") return pickLearn();
  if (S.mode === "weighted") return pickWeighted();
  if (S.mode === "recap") {
    if (!S.recap.queue.length) buildRecap();
    return S.recap.idx < S.recap.queue.length ? CASE_BY_N[S.recap.queue[S.recap.idx]] : null;
  }
  if (S.mode === "rad") {
    const sel = selected();
    if (!S.rad.queue.length || S.rad.queue.some((n) => !sel.includes(n)) || S.rad.idx >= S.rad.queue.length) buildRadQueue();
    return CASE_BY_N[S.rad.queue[S.rad.idx]] || null;
  }
  const pool = selected();
  if (!pool.length) return null;
  // Ikke samme case som den du står i (eller sist løste) – ellers kan «neste» gi samme case om og om igjen.
  const avoid = S.cur ? S.cur.c.n : S.last ? S.last.n : null;
  const choices = pool.length > 1 ? pool.filter((x) => x !== avoid) : pool;
  return CASE_BY_N[choices[rnd(choices.length)]];
}

const MODE_NAME = { drill: "Drill", learn: "Learn", recap: "Recap", weighted: "Weighted", rad: "På rad", recog: "Gjenkjenning", predict: "Predict", guided: "Guidet", slow: "Slow solve" };
// Bytt treningsmodus (ikke guidet – det er et hjelpemiddel oppå modusen, se toggleGuided).
function setMode(m, { start = true } = {}) {
  clearInterval(S.review.timer); S.review.timer = null;
  S.mode = S.baseMode = m; S.repeat = null;
  if (m === "rad") buildRadQueue();
  if (m === "learn") learnInit();
  if (m === "recap") buildRecap();
  if (start) startCase();
}

// Ett skritt videre i «på rad»-køen (etter n riktige, eller ved «neste case»).
function radAdvance(reason) {
  S.rad.idx++; S.rad.streak = 0;
  if (S.rad.idx >= S.rad.queue.length) {
    flash(reason === "done" ? "Runde ferdig – ny runde" : "Ny runde");
    if (S.block && S.block.untilRound) { S.block.roundDone = true; return; }
    buildRadQueue();
  } else if (reason === "done") flash(`✓ ${S.rad.n} på rad`);
}

// Ny case rett på den virtuelle kuben – den fysiske kuben trenger ikke settes opp.
function startCase(sameAgain = false) {
  hideOverlay();
  if (S.mode === "slow") { slowStart(); return; }
  // Tidsblokker går på overtid til du avslutter dem selv; bare rundeblokker slutter av seg selv.
  if (S.block && S.block.roundDone) { endBlock(); return; }
  if (S.mode === "predict") { if (S.predict.sub === "review") reviewShow(0); else newPredictRound(); return; }
  if (S.mode === "recog") { newRecogRound(); return; }
  const picked = sameAgain && S.cur ? S.cur.c : pickCase();
  // Samme case igjen beholder sporet; ellers trekkes et av de valgte sporene.
  const c = picked && (sameAgain && S.cur && S.cur.c.slot ? picked : variantFor(picked.n));
  if (!c) {
    const recapDone = S.mode === "recap" && S.recap.queue.length;
    if (recapDone && S.block) { endBlock(); return; }
    S.phase = "idle"; S.cur = null; render();
    if (recapDone) recapSummary();
    return;
  }
  let cur;
  if (sameAgain && S.cur && S.cur.startState) {
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
  cur.intro = S.mode === "learn" && c.n === learnCurrent() && !S.learn.intro.has(c.n);
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
  const strictGrip = (a) => !/[rludfbMES]|w/.test(a);
  const ok = [cur.c.alg, ...cur.c.alts].some((a) => sameSolution(cur.executed, expand(a).moves, { strictGrip: strictGrip(a) }));
  const quarters = (ms) => simplify(ms).filter((m) => m.face !== "D").reduce((s, m) => s + (m.amt === 2 ? 2 : 1), 0);
  const rawQ = cur.executed.filter((m) => m.face !== "D").length;
  const fixed = ok && rawQ > quarters(cur.alg.moves);
  const execMoves = simplify(cur.executed.slice(cur.execIdx)).length;
  const guided = S.mode === "guided" || cur.intro;
  const st = (S.stats[cur.c.key] ||= { reps: 0, ok: 0, exec: [], rec: [] });
  const prevMedian = median(st.exec);
  st.reps++;
  if (ok) { st.ok++; if (!guided) { st.exec.push(exec); st.rec.push(rec); } }
  S.attempts.count++;
  S.last = {
    n: cur.c.n, c: cur.c, ok, fixed, guided, rec, exec, total: rec + exec,
    tps: exec > 0 ? execMoves / (exec / 1000) : 0,
    median: median(st.exec), prevMedian, attempts: S.attempts.count,
    did: didInYourGrip(cur.executed),
  };
  log({
    block: S.block ? S.block.id : null, trainer: "f2l", case: cur.c.n, slot: cur.c.slot, mode: S.mode, intro: cur.intro || undefined,
    ok, fixed, rec: Math.round(rec), exec: Math.round(exec), tps: +S.last.tps.toFixed(2),
    did: S.last.did, alg: cur.c.alg, source: cur.c.source, auf: cur.aufAmt, colorShift: cur.colorShift || 0,
  });
  S.repeat = ok ? null : cur.c.n;
  if (guided) S.repeat = cur.c.n; // guidet: samme case til du går ut av guidet
  if (S.mode === "learn") {
    if (cur.intro) S.learn.intro.add(cur.c.n);
    else learnRecord(cur.c.n, ok, rec + exec);
  }
  if (S.mode === "recap") {
    if (ok) (S.recap.times[cur.c.n] ||= []).push(rec + exec);
    if (ok) S.recap.idx++; // avvist: casen gjentas (S.repeat) før køen går videre
  }
  if (S.mode === "rad") {
    if (ok) { S.rad.streak++; if (S.rad.streak >= S.rad.n) radAdvance("done"); }
    else S.rad.streak = 0;
    S.repeat = null; // køen styrer
  }
  if (S.mode === "guided") {
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

function recapSummary() {
  const rows = Object.entries(S.recap.times).map(([n, t]) => [+n, median(t)]).sort((a, b) => a[1] - b[1]);
  const li = (r) => r.map(([n, m]) => `<li>F2L ${n}: ${fmt(m)}</li>`).join("");
  $("phase").innerHTML = `<div class="big">Recap ferdig (${S.recap.queue.length} caser).</div>
    <div class="recapsum"><div><b>Raskest</b><ul>${li(rows.slice(0, 3))}</ul></div>${rows.length > 3 ? `<div><b>Tregest</b><ul>${li(rows.slice(-Math.min(3, rows.length - 3)).reverse())}</ul></div>` : ""}</div>
    <button id="recap-again">Ny recap</button>`;
  $("recap-again").onclick = () => { buildRecap(); startCase(); };
}

// ---------- historikk fra loggen (for «svakeste først») ----------
async function loadHist() {
  if (!LOG_URL) return;
  try {
    const r = await fetch(LOG_URL.replace(/\/api\/log$/, "/api/stats?days=14"));
    if (r.ok) {
      const j = await r.json();
      S.hist = (j.trainers && j.trainers.f2l) || j.cases || {};
      S.blocksEnded = j.blocksEnded || [];
      S.blockSolves = j.blockSolves || [];
      S.blockProgress = j.blockProgress || []; // avsluttede blokker fra loggen (✓ overlever omlasting)
      renderPlan();
    }
  } catch (e) { /* uten historikk brukes bare økta */ }
}

// ---------- plan: blokker med nedtelling ----------
async function loadPlan() {
  try {
    const r = await fetch("plans/plan.json", { cache: "no-store" });
    if (r.ok) S.plan = await r.json();
  } catch (e) { S.plan = null; }
  renderPlan();
}

function renderPlan() {
  const blocks = (S.plan && S.plan.blocks || []).filter((b) => b.trainer === "f2l" || b.trainer === "pll");
  const el = $("planbar");
  if (!blocks.length) { el.hidden = true; return; }
  el.hidden = false;
  // Blokker avsluttet på plandagen (norsk tid) ifølge loggen teller som ferdige, også etter omlasting.
  const day = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
  for (const e of S.blocksEnded || []) if (S.plan.date && e.t && day(e.t) === S.plan.date) S.blocksDone.add(e.block);
  el.innerHTML = `<span class="muted small">${S.plan.title || "Plan"} · ${S.plan.date || ""}</span>` + blocks.map((b) =>
    `<button class="blk ${S.block && S.block.id === b.id ? "on" : ""} ${S.blocksDone.has(b.id) ? "done" : ""}" data-block="${b.id}">
      <b>${b.name}</b><span>${blockDesc(b)}</span></button>`).join("") +
    (S.block ? `<span id="blocktimer" class="blocktimer"></span><button id="pauseblock" title="${S.mode === "slow" ? "Stopper blokkas klokke; solven du er i fortsetter" : "Klokka står og trekk ignoreres"}">${S.block.pausedAt ? "Fortsett" : "Pause"}</button><button id="stopblock">Avslutt blokk</button>` : "");
}

function blockDesc(b) {
  if (b.mode === "slow") return `${b.solves ? b.solves + " slow solves" : (b.minutes || 10) + " min slow solve"} · målcase ${b.cases.join(", ")}`;
  if (b.trainer === "pll") return `PLL · ${b.minutes ? b.minutes + " min · " : "én runde · "}${b.mode === "rad" ? `${b.n || 3} på rad` : b.mode || "drill"} · ${b.cases.join(", ")}`;
  const mode = MODE_NAME[b.mode] ? b.mode : "drill";
  const what = mode === "rad" ? `${b.n || 3} på rad${b.order === "weakest" || !b.order ? ", svakeste først" : b.order === "random" ? ", tilfeldig" : ""}`
    : mode === "recap" ? `recap ${b.repeat || 2}×` : MODE_NAME[mode].toLowerCase();
  return `${b.minutes ? b.minutes + " min · " : "én runde · "}${what} · ${b.cases.join(", ")}${b.slots ? " · " + b.slots.join("/") : ""}`;
}

// ---------- brukt tid i tidsblokker (logges, så blokka kan fortsette etter omlasting) ----------
// Brukt tid = planlagt tid − gjenstående (pause flytter slutten, så pause teller ikke). Over planlagt tid = overtid.
function blockElapsed(b) {
  if (!b || !b.minutes || !isFinite(b.end)) return null;
  return Math.max(0, Math.round(b.minutes * 60000 - (b.end - (b.pausedAt || performance.now()))));
}
function blockProgressLog(b, trainer) {
  const elapsed = blockElapsed(b);
  if (elapsed == null) return;
  const rec = { event: "block-progress", block: b.id, elapsed, trainer };
  log(rec);
  (S.blockLocal ||= []).push({ kind: "progress", block: b.id, t: new Date().toISOString(), elapsed });
}
// Sist kjente brukte tid for blokka på plandagen; 0 hvis den ikke er startet eller er avsluttet etterpå.
function progressFor(id) {
  const day = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
  const ev = [
    ...(S.blockProgress || []).map((e) => ({ ...e, kind: "progress" })),
    ...(S.blocksEnded || []).map((e) => ({ ...e, kind: "end" })),
    ...(S.blockLocal || []),
  ].filter((e) => e.block === id && e.t && (!S.plan || !S.plan.date || day(e.t) === S.plan.date)).sort((a, b) => (a.t < b.t ? -1 : 1));
  const last = ev[ev.length - 1];
  return last && last.kind === "progress" ? last.elapsed || 0 : 0;
}

// Slow solves i blokka på plandagen: fra loggen (lastet ved oppstart) og fra denne økta.
function solvesDone(id) {
  const day = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
  const ts = new Set();
  for (const e of [...(S.blockSolves || []), ...(S.blockSolvesLocal || [])])
    if (e.block === id && e.t && (!S.plan || !S.plan.date || day(e.t) === S.plan.date)) ts.add(e.t.slice(0, 19));
  return ts.size;
}

function startBlock(id) {
  const b = S.plan.blocks.find((x) => x.id === id);
  if (!b) return;
  if (b.trainer === "pll") { beep(0); switchTrainer("pll"); PLL.startBlock(b); return; }
  if (S.trainer !== "f2l") switchTrainer("f2l");
  beep(0); // lås opp lyd (krever klikk i rammen)
  S.selection = new Set(b.cases);
  S.slots = new Set((b.slots || ["FR"]).filter((sl) => SLOTS.includes(sl)));
  if (!S.slots.size) S.slots.add("FR");
  // Blokktyper: drill | weighted | learn | recog | predict (krever minutes), rad | recap (minutes eller én runde).
  const mode = MODE_NAME[b.mode] && b.mode !== "guided" ? b.mode : "drill";
  const oneRound = !b.minutes && (mode === "rad" || mode === "recap");
  const minutes = b.minutes || (oneRound ? 0 : 5);
  if (mode === "rad") { S.rad.n = b.n || 3; S.rad.order = b.order || "weakest"; }
  if (mode === "recap") { S.recap.repeat = b.repeat || 2; S.recap.instant = !!b.instant; S.recap.order = b.order || "random"; }
  if (mode === "learn") { S.learn.threshold = b.threshold || S.learn.threshold; }
  setMode(mode, { start: false });
  const prev = minutes ? progressFor(b.id) : 0; // fortsett der blokka slapp (samme dag)
  S.block = { id: b.id, name: b.name, minutes, untilRound: oneRound, end: minutes ? performance.now() + minutes * 60000 - prev : Infinity, lastProgress: performance.now() };
  if (prev) setTimeout(() => flash(`Fortsetter på ${mmss(prev)}`), 50);
  if (mode === "slow") { S.block.solves = b.solves || null; S.block.doneSolves = solvesDone(b.id); if (b.solves && !b.minutes) S.block.end = Infinity; }
  log({ event: "block-start", block: b.id, minutes: b.minutes, cases: b.cases, mode: S.mode });
  renderPlan();
  startCase();
  blockTick();
}

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function blockTick() {
  if (!S.block) return;
  const now = S.block.pausedAt || performance.now();
  const left = S.block.end - now;
  const el = $("blocktimer");
  const q = S.mode === "recap" || (S.mode === "guided" && S.baseMode === "recap") ? S.recap : S.rad;
  if (el && S.block.solves && !isFinite(left)) el.textContent = (S.block.pausedAt ? "⏸ " : "") + `${S.block.doneSolves}/${S.block.solves}`;
  else if (el) {
    el.textContent = (S.block.pausedAt ? "⏸ " : "") + (!isFinite(left) ? `${Math.min(q.idx + 1, q.queue.length)}/${q.queue.length}` : left > 0 ? mmss(left) : "+" + mmss(-left));
    el.classList.toggle("over", isFinite(left) && left <= 0);
  }
  if (!S.block.pausedAt && S.block.minutes && performance.now() - S.block.lastProgress >= 30000) { S.block.lastProgress = performance.now(); blockProgressLog(S.block, "f2l"); }
  // Tiden ute: blokken fortsetter på overtid (vises som +m:ss) til du trykker «Avslutt blokk».
  // Slow solve med tidsgrense avsluttes som før (kuben skal være klar for neste blokk).
  if (left <= 0 && !S.block.warned) {
    S.block.warned = true;
    beep(3);
    flash("Tiden er ute – fortsett eller avslutt");
    if (S.mode === "slow" && ["scramble", "needcross"].includes(S.slow.phase)) endBlock();
  }
  clearTimeout(blockTick.t);
  blockTick.t = setTimeout(blockTick, 250);
}

// Pause: blokkas klokke står. I drill o.l. ignoreres trekk, og casen startes på nytt ved fortsett, så pausen
// ikke havner i gjenkjenningstiden. I slow solve spores kuben fortsatt – solven du er i, går videre som før.
function togglePause() {
  if (!S.block) return;
  if (S.block.pausedAt) {
    S.block.end += performance.now() - S.block.pausedAt;
    S.block.pausedAt = null;
    flash("Fortsetter");
    if (S.mode !== "slow" && S.phase === "case" && S.cur) startCase(true);
  } else {
    S.block.pausedAt = performance.now();
    blockProgressLog(S.block, "f2l");
    flash("Pause");
  }
  renderPlan();
  blockTick();
}

function endBlock() {
  if (!S.block) return;
  log({ event: "block-end", block: S.block.id, elapsed: blockElapsed(S.block) });
  flush();
  (S.blockLocal ||= []).push({ kind: "end", block: S.block.id, t: new Date().toISOString() });
  S.blocksDone.add(S.block.id);
  const name = S.block.name;
  S.block = null;
  loadHist();
  S.phase = "idle"; S.cur = null;
  hideOverlay();
  render();
  renderPlan();
  $("phase").innerHTML = `<div class="big">«${name}» ferdig. Velg neste blokk.</div>`;
}

let audio = null;
function beep(times) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      const t = audio.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.26);
    }
  } catch (e) { /* lyd ikke tilgjengelig */ }
}

// ---------- felles: en konkret forekomst av en case ----------
function makeInstance(c) {
  const alg = expand(c.alg);
  const pre = S.mixLL ? [...expand(LL_SCRAMBLERS[rnd(LL_SCRAMBLERS.length)]).moves, { face: "D", amt: rnd(4) }] : [];
  const auf = rnd(4);
  const state = simplify([...pre, ...invert(alg.moves), { face: "D", amt: auf }]).reduce((st, m) => turn(st, m.face, m.amt), SOLVED);
  const { items, aufAmt } = withPreAuf((4 - auf) % 4, alg.moves);
  const rest = items.filter((m) => !m.auf);
  // Alle AUF-er som gjør at algoritmen løser casen (står paret i sporet, virker alle fire).
  const valid = new Set([0, 1, 2, 3].filter((k) => f2lSolved(rest.reduce((st, m) => turn(st, m.face, m.amt), turn(state, "D", k)))));
  return { c, alg, state, start: state, items, aufAmt, valid, colorShift: S.colorSwap ? rnd(4) : 0, t0: performance.now() };
}
const AUF_NAME = ["Ingen", "U", "U2", "U'"];
const shuffle = (xs) => xs.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

function stripHtml(list) {
  return `<div class="strip">${list.slice(-24).map((r) => `<span class="${r.ok ? "g" : "b"}" title="F2L ${r.n} · ${fmt(r.t)}">${r.n}</span>`).join("")}</div>`;
}
function scoreLine(R) {
  const ok = R.results.filter((r) => r.ok);
  return `<div class="radprog">Riktig ${ok.length}/${R.results.length} · median ${ok.length ? fmt(median(ok.map((r) => r.t))) : "–"} s · rekke ${R.combo} (beste ${R.best})</div>${stripHtml(R.results)}`;
}
function record(R, mode, n, ok, t, extra) {
  R.combo = ok ? R.combo + 1 : 0; R.best = Math.max(R.best, R.combo);
  R.results.push({ n, ok, t });
  log({ block: S.block ? S.block.id : null, trainer: "f2l", mode, case: n, ok, rec: Math.round(t), ...extra });
}
function nextAfter(ok, fn, slow = 1500) {
  S.phase = "pause"; render();
  setTimeout(() => { if (S.phase === "pause") fn(); }, ok ? 250 : slow);
}

// ---------- Gjenkjenning: Pre-AUF og Navn (fast bilde) ----------
// Pre-AUF: hvilken AUF trenger casen før algoritmen? Knapper/piltaster, eller gjør U-trekkene på kuben
// og start algoritmen (første trekk som ikke er U bekrefter). Navn: hvilken algoritme hører til casen?
function newRecogRound() {
  let c = pickCase();
  if (!c) { S.phase = "idle"; S.cur = null; render(); return; }
  let r = makeInstance(c);
  // Pre-AUF: caser der paret står i sporet (37–41) har ingen AUF å kjenne igjen – hopp over dem.
  for (let i = 0; S.recog.sub === "auf" && r.valid.size === 4 && i < 50; i++) { S.cur = { c }; c = pickCase(); r = makeInstance(c); }
  if (S.recog.sub === "auf" && r.valid.size === 4) { S.phase = "idle"; S.cur = null; render(); $("phase").innerHTML = `<div class="big">Casene du har valgt har ingen AUF (paret står i sporet).</div>`; return; }
  r.net = 0;
  if (S.recog.sub === "name") {
    const pool = shuffle([...selected().filter((n) => n !== c.n), ...shuffle(CASES.map((x) => x.n).filter((n) => n !== c.n && !S.selection.has(n)))]);
    r.options = shuffle([c.n, ...pool.slice(0, S.recog.options - 1)]);
  }
  S.recog.round = r;
  S.cur = { c, colorShift: r.colorShift };
  S.phase = "recog";
  render();
}
function answerAuf(k) {
  const r = S.recog.round;
  if (!r || S.phase !== "recog" || S.recog.sub !== "auf") return;
  const ok = r.valid.has(k), t = performance.now() - r.t0;
  record(S.recog, "recog-auf", r.c.n, ok, t, { auf: r.aufAmt, answer: k });
  flash(ok ? `✓ ${fmt(t)}` : `✗ ${AUF_NAME[r.aufAmt]} (du: ${AUF_NAME[k]})`);
  nextAfter(ok, newRecogRound);
}
function answerName(n) {
  const r = S.recog.round;
  if (!r || S.phase !== "recog" || S.recog.sub !== "name") return;
  const ok = n === r.c.n, t = performance.now() - r.t0;
  record(S.recog, "recog-name", r.c.n, ok, t, { answer: n });
  flash(ok ? `✓ ${fmt(t)}` : `✗ ${r.c.alg}`);
  nextAfter(ok, newRecogRound, 2200);
}
function recogPanel() {
  const R = S.recog, r = R.round;
  if (!r) return "";
  const img = `<div class="recogcube">${cubeSvg(r.state, { colorMap: colorMapFor(r.colorShift) })}</div>`;
  if (R.sub === "auf") {
    const keys = ["↓", "←", "↑", "→"];
    return `${img}<div class="pred-q">Hvilken AUF før algoritmen?</div>
      <div class="o-keys">${AUF_NAME.map((nm, k) => `<button data-auf="${k}">${nm} <kbd>${keys[k]}</kbd></button>`).join("")}</div>
      <div class="muted small">Med kuben: gjør U-trekkene og start algoritmen.</div>${scoreLine(R)}`;
  }
  const thumb = (n) => R.images ? cubeSvg(simplify(invert(expand(CASE_BY_N[n].alg).moves)).reduce((st, m) => turn(st, m.face, m.amt), SOLVED)) : "";
  return `${img}<div class="pred-q">Hvilken algoritme løser casen?</div>
    <div class="nameopts">${r.options.map((n, i) => `<button data-name="${n}">${thumb(n)}<span>${CASE_BY_N[n].alg}</span> <kbd>${i + 1}</kbd></button>`).join("")}</div>${scoreLine(R)}`;
}

// ---------- Predict: Predict og Review ----------
// Predict: Før, algoritme og Etter (F2L løst) – virker algoritmen? Halvparten er ekte.
// Svar: knapper, piltaster (← nei, → ja) eller kuben (U' nei, U ja).
function newPredictRound() {
  const c = pickCase();
  if (!c) { S.phase = "idle"; S.cur = null; render(); return; }
  const alg = expand(c.alg);
  const pre = S.mixLL ? [...expand(LL_SCRAMBLERS[rnd(LL_SCRAMBLERS.length)]).moves, { face: "D", amt: rnd(4) }] : [];
  const genuine = Math.random() < 0.5;
  const build = (moves, k) => simplify([...pre, ...invert(moves), { face: "D", amt: k }]).reduce((st, m) => turn(st, m.face, m.amt), SOLVED);
  const solves = (st) => f2lSolved(alg.moves.reduce((x, m) => turn(x, m.face, m.amt), st));
  let before = build(alg.moves, 0);
  if (!genuine) {
    // Falsk: casen med en annen AUF. Står paret i sporet (37–41), gjør AUF ingen forskjell – da en annen case.
    before = build(alg.moves, 1 + rnd(3));
    for (let i = 0; solves(before) && i < 200; i++) before = build(expand(CASES[rnd(CASES.length)].alg).moves, rnd(4));
  }
  const after = pre.reduce((st, m) => turn(st, m.face, m.amt), SOLVED);
  S.predict.round = { c, genuine, before, after, colorShift: S.colorSwap ? rnd(4) : 0, t0: performance.now() };
  S.cur = { c, colorShift: S.predict.round.colorShift };
  S.phase = "predict";
  render();
}
function predictAnswer(yes) {
  const P = S.predict, r = P.round;
  if (!r || S.phase !== "predict") return;
  const ok = yes === r.genuine, t = performance.now() - r.t0;
  record(P, "predict", r.c.n, ok, t, { genuine: r.genuine, answer: yes, view: P.view });
  flash(ok ? `✓ ${fmt(t)}` : r.genuine ? "✗ Den virket" : "✗ Den virket ikke");
  nextAfter(ok, newPredictRound);
}
function predictPanel() {
  const r = S.predict.round, P = S.predict;
  if (!r) return "";
  const map = colorMapFor(r.colorShift);
  return `<div class="pred">
      <div><div class="muted small">FØR</div>${cubeSvg(r.before, { colorMap: map, show: P.view })}</div>
      <div class="pred-alg">${r.c.alg}<span>→</span></div>
      <div><div class="muted small">ETTER</div>${cubeSvg(r.after, { colorMap: map })}</div>
    </div>
    <div class="pred-q">Gjør algoritmen Før om til Etter?</div>
    <div class="o-keys"><button id="p-no">Nei <kbd>←</kbd></button><button id="p-yes" class="next">Ja <kbd>→</kbd></button></div>${scoreLine(P)}`;
}

// Review: bla gjennom casene i en 3D-spiller, spill av algoritmen, eller bygg casen fra en ny tilstand.
function reviewShow(delta = 0, fresh = true) {
  const sel = selected();
  if (!sel.length) { S.phase = "idle"; S.cur = null; render(); return; }
  const V = S.review;
  clearInterval(V.timer); V.timer = null;
  V.idx = ((V.idx + delta) % sel.length + sel.length) % sel.length;
  if (fresh || !V.inst || V.inst.c.n !== sel[V.idx]) V.inst = makeInstance(CASE_BY_N[sel[V.idx]]);
  V.inst.state = V.inst.start;
  S.cur = { c: V.inst.c, colorShift: V.inst.colorShift };
  S.phase = "review";
  if (view3d) { view3d.setColorShift(V.inst.colorShift); view3d.set(V.inst.state, true); }
  render();
}
function reviewPlay() {
  const V = S.review, inst = V.inst;
  if (!inst || !view3d) return;
  reviewShow(0, false);
  let i = 0;
  V.timer = setInterval(() => {
    const m = inst.items[i++];
    if (!m) { clearInterval(V.timer); V.timer = null; return; }
    inst.state = turn(inst.state, m.face, m.amt);
    view3d.move(m.face, m.amt, inst.state, true);
  }, 1000 / S.predict.tps);
}
function reviewPanel() {
  const V = S.review, inst = V.inst;
  if (!inst) return "";
  const c = inst.c, sel = selected();
  return `<div class="caseinfo"><b>F2L ${c.n}</b> <span class="muted">bok ${c.bookNo}, s. ${c.bookPage} · ${V.idx + 1} av ${sel.length}</span></div>
    <div class="alg">${inst.aufAmt ? `<span class="mv auf">(${AUF_NAME[inst.aufAmt]})</span>` : ""}${inst.alg.tokens.map((t, i) => (inst.alg.moves[0] && inst.alg.moves[0].face === "D" && inst.alg.moves[0].tok === i ? "" : `<span class="mv">${t}</span>`)).join("")}</div>
    <div class="o-keys"><button id="rv-prev">◀ Forrige</button><button id="rv-play" class="next">▶ Spill av</button><button id="rv-rand">Ny variant</button><button id="rv-next">Neste ▶</button></div>`;
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
  if (S.mode === "recog" || S.mode === "predict" || S.mode === "slow") { flash("Guidet gjelder ikke her"); return; }
  if (S.mode === "guided") {
    S.mode = S.baseMode; S.repeat = null;
    flash(MODE_NAME[S.mode]);
    if (S.mode === "rad") {
      if (!S.rad.queue.length) buildRadQueue();
      const i = S.cur ? S.rad.queue.indexOf(S.cur.c.n) : -1; // fortsett i køen der casen du øvde på står
      if (i >= 0) { S.rad.idx = i; S.rad.streak = 0; }
    }
    startCase(true);
  }
  else { S.baseMode = S.mode; S.mode = "guided"; flash("Guidet"); startCase(true); }
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
  else if (kind === "next") {
    S.repeat = null;
    if (S.mode === "rad") radAdvance("skip");
    else { if (S.mode === "recap") S.recap.idx++; flash("Neste case"); }
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

// ---------- trekk inn ----------
function onMove(face, a) {
  if (S.trainer === "pll") { PLL.onMove(face, a); return; }
  if (S.block && S.block.pausedAt && S.mode !== "slow") return;
  const now = performance.now();
  if (S.mode === "slow") { slowMove(face, a, now); return; }
  if (S.mode === "predict") { if (S.phase === "predict" && face === "D") predictAnswer(a === 1); return; }
  if (S.mode === "recog") {
    const r = S.recog.round;
    if (S.phase !== "recog" || S.recog.sub !== "auf" || !r) return;
    if (face === "D") { r.net = (r.net + a) % 4; r.state = turn(r.state, "D", a); render(); }
    else answerAuf(r.net); // første trekk som ikke er U bekrefter AUF-en du har gjort
    return;
  }
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
  // Grepet ved trekket og 120 ms etter (gyroen kan ligge litt etter trekket rett etter en rotasjon).
  const mv = { face, amt: a, grip: liveGrip() || cur.lastGrip || START_GRIP };
  cur.lastGrip = mv.grip;
  mv.grips = mv.grip ? [mv.grip] : [];
  setTimeout(() => { const g = liveGrip(); if (g) mv.grips.push(g); }, 120);
  cur.executed.push(mv);
  cur.guide.step(face, a, liveGrip());
  // Tiden starter ved første trekk som ikke er U (AUF), og nullstilles hvis kuben er tilbake i casen.
  if (cur.execStart == null && face !== "D") { cur.execStart = now; cur.execIdx = cur.executed.length - 1; }
  else if (cur.execStart != null && cur.startSet.has(S.facelets)) { cur.execStart = null; }
  if (fourInRow(cur.recent, face, a, now) && CASE_SHORTCUT[face]) { shortcut(CASE_SHORTCUT[face]); return; }
  if (f2lSolved(S.facelets)) finishCase(); else render();
}


// ---------- slow solve ----------
// Den fysiske kuben følges trekk for trekk (egen simulering, kontrollert mot acubemys tilstand).
// Scramble → kryss (vurderes ikke) → F2L: hvert par som settes inn vurderes mot avtalt løsning.
// Feil: lyd, rød retting tilbake til før algoritmen, og avtalt løsning. Så prøver du igjen.
function slowStart() {
  const W = S.slow;
  S.cur = null; S.phase = "slow";
  const f = window.acubemy && acubemy.getFacelets && acubemy.getFacelets();
  if (f && f.length === 54) S.facelets = f;
  W.lastBefore = null; W.pending = null;
  if (view3d) { view3d.colorMap = {}; view3d.set(S.facelets, false); }
  slowNewScramble();
  render();
}
// Scramblen bevarer krysset. Står F2L (etter forrige slow solve, eller løst kube), får scramblen alltid
// én av casene i utvalget (målcasen) i et tilfeldig spor; de andre parene blandes fritt.
function slowNewScramble() {
  const W = S.slow;
  W.pairs = []; W.corr = null; W.wrong = null; W.note = null; W.f2l = false; W.retry = null; W.guide = null; W.guideAfter = false;
  if (!crossSolved(S.facelets)) { W.phase = "needcross"; W.target = null; return; }
  W.no++;
  const pool = CASES.map((c) => c.n).filter((n) => S.selection.has(n));
  const choices = pool.length > 1 ? pool.filter((n) => n !== (W.target && W.target.n)) : pool;
  if (f2lSolved(S.facelets) && choices.length) {
    const n = choices[rnd(choices.length)], slot = SENSOR_SLOTS[rnd(4)];
    W.target = { n, slot };
    W.scramble = makeTargetScramble(n, slot);
  } else {
    W.target = null;
    W.scramble = makeCrossScramble();
  }
  W.tracker = new Tracker(W.scramble.map((m) => ({ ...m })));
  W.phase = "scramble";
}
function slowResetSeg(now) {
  S.slow.seg = { start: S.facelets, moves: [], grip: liveGrip() || S.slow.lastGrip || START_GRIP, t: now };
}
function slowMove(face, a, now) {
  const W = S.slow;
  W.lastBefore = S.facelets;
  W.pending = { before: S.facelets, face, a };
  S.facelets = turn(S.facelets, face, a);
  if (view3d) view3d.move(face, a, S.facelets, false);
  const mv = { face, amt: a, grip: liveGrip() || W.lastGrip || START_GRIP, t: now };
  W.lastGrip = mv.grip;
  mv.grips = [mv.grip];
  setTimeout(() => { const g = liveGrip(); if (g) mv.grips.push(g); }, 120);
  if (W.phase === "scramble") {
    W.tracker.step(face, a);
    if (!W.tracker.items.length) {
      W.phase = "solve"; W.t0 = now; W.solved = solvedSlots(S.facelets); W.f2l = crossSolved(S.facelets);
      slowResetSeg(now);
    }
  } else if (W.phase === "correct") {
    W.corr.step(face, a);
    if (!W.corr.items.length) {
      W.retry = W.wrong; // står du fast: R4 eller «Guidet» gir avtalt løsning trekk for trekk
      W.phase = "solve"; W.wrong = null; W.solved = solvedSlots(S.facelets);
      slowResetSeg(now);
      if (W.guideAfter) { W.guideAfter = false; slowStartGuide(); } else flash("Prøv igjen");
    }
  } else if (W.phase === "back") {
    W.corr.step(face, a);
    if (!W.corr.items.length) slowBackDone(now);
  } else if (W.phase === "guide") {
    W.guide.step(face, a, mv.grip);
    if (!W.guide.items.length) slowEndGuide(now);
  } else if (W.phase === "solve") {
    W.seg.moves.push(mv);
    // Gul U4 (hvit ned) = kalibrer gyro, som ellers. Fire like U-trekk endrer ikke kuben, så de tas ut av sporingen.
    W.recent = [...(W.recent || []), { face, a, t: now }].slice(-4);
    if (fourInRow(W.recent, face, a, now) && face === "D") {
      if (window.acubemy) acubemy.calibrateGyro();
      W.seg.moves.splice(-4); W.recent = []; flash("Gyro kalibrert");
    }
    // Oransje R4 (hvit ned) etter en retting = guidet avtalt løsning. Fire like trekk endrer ikke kuben.
    if (W.retry && fourInRow(W.recent, face, a, now) && face === "L") {
      W.seg.moves.splice(-4); W.recent = []; slowStartGuide(); render(); return;
    }
    slowCheck(now);
  } else if (W.phase === "needcross") {
    if (crossSolved(S.facelets)) slowNewScramble();
  } else if (W.phase === "ll") {
    if (S.facelets === SOLVED) slowFinish(now);
  }
  render();
}
function slowCheck(now) {
  const W = S.slow, f = S.facelets;
  if (!crossSolved(f)) return; // midt i en innsetting er krysset brutt – vurder når det står igjen
  const solvedNow = solvedSlots(f);
  if (!W.f2l) { W.f2l = true; W.crossMs = now - W.t0; W.solved = solvedNow; slowResetSeg(now); }
  const fresh = [...solvedNow].filter((sl) => !W.solved.has(sl));
  W.solved = solvedNow;
  if (fresh.length > 1) {
    W.pairs.push({ verdict: "ikke-vurdert", why: "to par samtidig" });
    W.note = { cls: "muted", text: "To par satt inn samtidig – ikke vurdert" };
    slowResetSeg(now);
  } else if (fresh.length === 1) {
    const seg = W.seg;
    const r = judgePair({ start: seg.start, moves: seg.moves, slot: fresh[0], startGrip: seg.grip });
    W.retry = null;
    const from = r.from != null ? seg.moves[r.from] : null;
    const rec = from ? from.t - seg.t : null, exec = from ? now - from.t : null;
    W.pairs.push({ ...r, rec, exec });
    log({ block: S.block ? S.block.id : null, trainer: "f2l", mode: "slowsolve", solve: W.no, case: r.n ?? null, slot: r.held || null,
      ok: r.verdict === "ok", verdict: r.verdict, rec: rec != null ? Math.round(rec) : null, exec: exec != null ? Math.round(exec) : null,
      did: r.did, alg: r.alg || (r.hint && r.hint.alg) || null });
    // Alarm for alle innførte caser (og det du har valgt). Caser uten bestemt løsning logges uten alarm.
    const inSel = r.n != null && (INTRODUCED.includes(r.n) || S.selection.has(r.n));
    if (r.verdict === "feil" && !inSel) {
      W.pairs[W.pairs.length - 1].verdict = "utenfor";
      W.note = { cls: "muted", text: `F2L ${r.n} (${r.held}) – ikke innført ennå, ingen alarm. Bokas: ${r.alg}` };
    } else if (r.verdict === "feil") {
      beep(2);
      W.phase = "correct"; W.wrong = r;
      W.corr = new Tracker(r.undo.map((m) => ({ face: m.face, amt: m.amt })));
      W.note = null;
      return;
    } else if (r.verdict === "ok") { W.note = { cls: "ok", text: `✓ F2L ${r.n} · ${r.held}` }; flash(`✓ ${r.n} ${r.held}`); }
    else if (r.verdict === "ikke-avtalt") {
      W.note = { cls: "warn", text: `F2L ${r.n} løst i ${r.held || "?"} – i ${r.held || "det sporet"} har vi ikke avtalt noen løsning (ingen alarm).${r.hint ? ` Avtalt: ${r.hint.rot ? `roter ${r.hint.rot} så paret står i ${r.hint.held}, og gjør ` : `i ${r.hint.held}: `}${r.hint.alg}` : ""}` };
    } else W.note = { cls: "muted", text: "Paret sto ikke som en av de 41 casene – ikke vurdert" };
    slowResetSeg(now);
  }
  if (solvedNow.size === 4) {
    if (W.end === "f2l") slowFinish(now);
    else W.phase = "ll";
  }
}
function slowFinish(now) {
  const W = S.slow;
  const cnt = (v) => W.pairs.filter((p) => p.verdict === v).length;
  W.last = { no: W.no, ok: cnt("ok"), feil: cnt("feil"), na: cnt("ikke-avtalt") + cnt("utenfor"), nv: cnt("ikke-vurdert"), ms: now - W.t0, pairs: W.pairs, target: W.target };
  const rec = { event: "slowsolve", trainer: "f2l", mode: "slowsolve", block: S.block ? S.block.id : null, solve: W.no, end: W.end, scramble: W.scramble.map(heldName).join(" "), target: W.target ? W.target.n : null,
    ok: W.last.ok, feil: W.last.feil, ikkeAvtalt: W.last.na, ikkeVurdert: W.last.nv, ms: Math.round(W.last.ms), crossMs: W.crossMs != null ? Math.round(W.crossMs) : null };
  log(rec);
  if (rec.block) (S.blockSolvesLocal ||= []).push({ block: rec.block, t: new Date().toISOString() });
  beep(1);
  slowNewScramble();
  if (S.block && S.block.solves) { S.block.doneSolves = solvesDone(S.block.id); if (S.block.doneSolves >= S.block.solves) endBlock(); }
}
// Guidet avtalt løsning i slow solve (etter en retting, når du står fast). Teller ikke som riktig.
function slowStartGuide() {
  const W = S.slow, r = W.retry;
  if (!r || !r.grip) { W.retry = null; return; }
  const all = expand(r.alg, r.grip).moves.map((m) => ({ face: m.face, amt: m.amt, grip: m.grip }));
  let k0 = 0; while (k0 < all.length && all[k0].face === "D") k0++;
  const rest = all.slice(k0);
  // AUF slik kuben står nå (bokas innledende U-trekk erstattes av det som faktisk trengs)
  for (let k = 0; k < 4; k++) {
    let f = S.facelets;
    const seq = k ? [{ face: "D", amt: k, auf: true }, ...rest] : rest;
    for (const m of seq) f = turn(f, m.face, m.amt);
    if (crossSolved(f) && solvedSlots(f).has(r.slot)) {
      W.guide = new Tracker(seq); W.guideSeq = seq; W.guideCase = r; W.phase = "guide"; W.retry = null;
      flash("Guidet – følg trekkene");
      return;
    }
  }
  W.retry = null; flash("Fant ikke avtalt løsning herfra – løs paret selv");
}
function slowEndGuide(now) {
  const W = S.slow, r = W.guideCase;
  log({ block: S.block ? S.block.id : null, trainer: "f2l", mode: "guided", solve: W.no, case: r.n, slot: r.held, ok: true, alg: r.alg });
  // Tilbake til casen, så du kan ta den guidet igjen (R4) eller prøve uten guide. «Hopp over» fortsetter solven.
  W.phase = "back"; W.guide = null; W.backCase = r;
  W.corr = new Tracker(simplify(invert(W.guideSeq.map((m) => ({ face: m.face, amt: m.amt })))));
  W.note = null;
}
function slowBackDone(now) {
  const W = S.slow;
  W.retry = W.backCase; W.backCase = null; W.corr = null; W.guideCase = null;
  W.phase = "solve"; W.solved = solvedSlots(S.facelets);
  slowResetSeg(now);
  flash("Prøv uten guide");
}
function slowSkipBack() {
  const W = S.slow;
  if (W.phase !== "back") return;
  const r = W.backCase;
  W.backCase = null; W.corr = null; W.guideCase = null; W.retry = null;
  W.phase = "solve"; W.solved = solvedSlots(S.facelets);
  W.note = { cls: "warn", text: `F2L ${r.n} (${r.held}) guidet – teller ikke. Avtalt: ${r.alg}` };
  slowResetSeg(performance.now());
  slowCheck(performance.now());
  render();
}
function slowSkipCorr() {
  const W = S.slow;
  if (W.phase !== "correct") return;
  W.phase = "solve"; W.wrong = null; W.corr = null; W.retry = null; W.guideAfter = false; W.solved = solvedSlots(S.facelets);
  slowResetSeg(performance.now());
  render();
}
// acubemy sender tilstanden ved hvert trekk. Den kan ligge ett trekk etter (tilstanden FØR trekket);
// begge deler godtas. Stemmer ingen av dem, er sporingen ute av takt → bruk acubemys tilstand.
function slowSync(f) {
  const W = S.slow, p = W.pending;
  W.pending = null;
  if (!f || f.length !== 54 || f === S.facelets) { if (p) W.lag.post++; return; }
  if (p && f === p.before) { W.lag.pre++; return; }
  if (!p && f === W.lastBefore) return; // ligger ett trekk etter, uten nytt trekk
  S.facelets = p && W.lag.pre >= W.lag.post ? turn(f, p.face, p.a) : f;
  slowSynced("Synket med acubemy");
}
function slowSynced(msg, reset = false) {
  const W = S.slow;
  if (view3d) view3d.set(S.facelets, false);
  // Ny tilstand midt i scramble, retting eller guidet (eller «Kuben er løst»): det som var igjen å gjøre,
  // gjelder ikke lenger. Start på nytt fra kuben slik den er nå (ny scramble, eller «løs krysset»).
  if (reset || !["solve", "ll"].includes(W.phase)) {
    W.corr = null; W.wrong = null; W.guide = null; W.guideCase = null; W.backCase = null; W.retry = null; W.guideAfter = false;
    W.no = Math.max(0, W.no - (W.phase === "scramble" ? 1 : 0)); // scramblen ble aldri løst – samme nummer igjen
    slowNewScramble();
  } else if (W.phase === "solve") { W.solved = solvedSlots(S.facelets); W.f2l = crossSolved(S.facelets); slowResetSeg(performance.now()); }
  flash(msg);
  render();
}
function slowPanel() {
  const W = S.slow;
  const pairChip = (p) => {
    const cls = { ok: "ok", feil: "bad", "ikke-avtalt": "warn" }[p.verdict] || "muted";
    return `<span class="pp ${cls}" title="${p.verdict}${p.did ? " · du gjorde: " + p.did : ""}">${p.n ?? "?"}${p.held ? " " + p.held : ""}</span>`;
  };
  const pairs = W.pairs.length ? `<div class="pps">${W.pairs.map(pairChip).join("")}</div>` : "";
  const last = W.last ? `<div class="muted small">Forrige: ${W.last.target ? `målcase ${W.last.target.n} · ` : ""}${W.last.ok} riktige · ${W.last.feil} feil · ${W.last.na} uten alarm · ${W.last.nv} ikke vurdert · ${fmt(W.last.ms)} s</div>` : "";
  if (W.phase === "scramble") {
    const items = W.tracker.items;
    const left = items.filter((m) => !m.corr).length;
    const doneN = W.scramble.length - left;
    const firstOpen = items.findIndex((m) => !m.corr);
    return `<div class="hint">Scramble ${W.no} – hold <b>hvit ned, grønn foran</b> · krysset står${W.target ? " · én av fokuscasene (utvalget i «Caser») er med" : ""}</div>
      <div class="scr">${chips(W.scramble.slice(0, Math.max(0, doneN)).map(heldName), "done")}${items.map((m, i) => `<span class="mv ${m.corr ? "bad" : i === firstOpen ? "now" : ""}">${heldName(m)}</span>`).join("")}</div>
      ${items.some((m) => m.corr) ? `<div class="slowbad small">Rødt = rett opp først</div>` : ""}
      ${last}${W.last ? `<div class="pps">${W.last.pairs.map(pairChip).join("")}</div>` : ""}`;
  }
  if (W.phase === "correct" && W.wrong) {
    const r = W.wrong, g = liveGrip() || START_GRIP;
    return `<div class="slowbad big">Feil løsning – F2L ${r.n} i ${r.held}</div>
      <div>Du gjorde: <span class="mono">${r.did}</span></div>
      <div class="hint">Tilbake til før algoritmen:</div>
      <div class="scr">${W.corr.items.map((m) => `<span class="mv bad">${gripNotation(m, g)}</span>`).join("")}</div>
      <div>Så avtalt løsning (${r.held}): <b class="mono">${r.alg}</b></div>
      <button id="slow-skipcorr">Hopp over</button> <button id="slow-guideafter" class="${W.guideAfter ? "on" : ""}">${W.guideAfter ? "Guidet etter retting ✓" : "Guidet etter retting"}</button>${pairs}`;
  }
  if (W.phase === "back" && W.backCase) {
    const r = W.backCase, g = liveGrip() || START_GRIP;
    return `<div class="okline big">Guidet ferdig – F2L ${r.n} i ${r.held}</div>
      <div class="hint">Tilbake til casen, så kan du ta den guidet igjen (oransje R4) eller prøve uten guide:</div>
      <div class="scr">${W.corr.items.map((m, i) => `<span class="mv ${m.corr ? "bad" : i === 0 ? "now" : ""}">${gripNotation(m, g)}</span>`).join("")}</div>
      <button id="slow-skipback">Hopp over – fortsett solven</button>${pairs}`;
  }
  if (W.phase === "guide" && W.guide) {
    const r = W.guideCase, g = liveGrip() || START_GRIP, items = W.guide.items, head = items[0];
    const need = head && !head.corr && !head.auf && head.grip ? yNeeded(g, head.grip) : "";
    return `<div class="warnline big">Guidet – F2L ${r.n} i ${r.held} (teller ikke)</div>
      <div>Avtalt: <b class="mono">${r.alg}</b></div>
      ${need ? `<div class="hint">Roter: <span class="mv now">${need}</span></div>` : ""}
      <div class="scr">${items.map((m, i) => `<span class="mv ${m.corr ? "bad" : i === 0 ? "now" : ""}">${m.auf ? heldName(m) : gripNotation(m, m.corr ? g : m.grip || g)}</span>`).join("")}</div>
      ${items.some((m) => m.corr) ? `<div class="slowbad small">Rødt = rett opp først</div>` : ""}${pairs}`;
  }
  if (W.phase === "needcross") return `<div class="hint">Løs krysset (eller hele kuben) – så kommer scramblen. Den bevarer krysset.</div>${last}`;
  const status = W.phase === "ll" ? "F2L ferdig – løs siste lag (vurderes ikke ennå)"
    : !W.f2l ? "Løs krysset (hvit ned). F2L-parene vurderes når krysset står."
    : `F2L: ${W.solved.size} av 4 par · hvert par vurderes når det er satt inn`;
  const gg = liveGrip();
  const COL = { U: "hvit", D: "gul", F: "grønn", B: "blå", R: "rød", L: "oransje" };
  const gyroLine = gg ? `<div class="muted small">Gyroen leser: ${COL[gg.D]} ned · ${COL[gg.F]} foran · ${COL[gg.R]} til høyre. Sporet vurderes slik du holder kuben ved første trekk i casen.</div>` : `<div class="warnline small">Ingen gyro – sporet vurderes som om du holder hvit ned, grønn foran</div>`;
  return `<div class="hint">${status}</div>${W.phase === "solve" ? gyroLine : ""}
    ${W.retry ? `<div class="warnline">Prøv F2L ${W.retry.n} igjen · står du fast: oransje R4 eller <button id="slow-guide">Guidet</button></div>` : ""}
    ${W.note ? `<div class="${W.note.cls === "ok" ? "okline" : W.note.cls === "warn" ? "warnline" : "muted"}">${W.note.text}</div>` : ""}
    ${pairs}${last}`;
}

// ---------- visning ----------
let ticking = false;
function tick() {
  if (ticking) return;
  ticking = true;
  const loop = () => {
    if (S.phase !== "case" || !S.cur) { ticking = false; return; }
    const el = $("timer");
    if (el) el.textContent = S.cur.execStart != null ? fmt(performance.now() - S.cur.execStart) : "0.00";
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const chips = (list, cls = "") => list.map((t) => `<span class="mv ${cls}">${t}</span>`).join("");

let testGrip = null; // bare for nettlesertester (window.__setGrip), aldri satt i acubemy
function liveGrip() { return testGrip || (view3d ? view3d.grip() : null); }
function notate(m, fallbackGrip) {
  const g = liveGrip();
  return g ? gripNotation(m, g) : fallbackGrip ? gripNotation(m, fallbackGrip) : heldNotation(m);
}

// Påminnelse (begge moduser) før utførelsen starter: står kuben rotert fra forrige case?
function rotateReminder(cur) {
  const g = liveGrip();
  if (!g || cur.execStart != null) return "";
  const need = yNeeded(g, START_GRIP);
  // Bare for rotasjon som henger igjen fra forrige case: har kuben vært i startgrepet i denne casen,
  // er en senere rotasjon en del av løsningen (f.eks. y' før eller etter AUF) og skal ikke stoppes.
  if (need === "") { cur.homeSeen = true; return ""; }
  if (cur.homeSeen || cur.executed.length) return "";
  if (S.mode === "guided") {
    const head = cur.guide.items.find((m) => !m.corr);
    if (head && !head.auf) return ""; // guidet viser rotasjonen i algoritmelinja i stedet
  }
  return need ? `Roter tilbake <span class="mv">${need}</span>` : "Hold hvit ned og grønn foran";
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
      msg = `<div class="hint">Roter: <span class="mv now">${need}</span></div>`;
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
  const st = S.stats[cur.c.key];
  const best = st && st.exec.length ? fmt(Math.min(...st.exec)) : "–";
  const med = st && st.exec.length ? fmt(median(st.exec)) : "–";
  const svg = cubeSvg(simplify(cur.startState).reduce((s, m) => turn(s, m.face, m.amt), SOLVED), { colorMap: colorMapFor(cur.colorShift || 0) });
  return `<div class="gc-head"><span class="muted small">GUIDET</span><b>F2L ${cur.c.n}${cur.c.slot !== "FR" ? " · " + cur.c.slot : ""}</b></div>
    <div class="gc-cube">${svg}</div>
    <div class="muted small">${cur.c.slot}-spor · bok ${cur.c.bookNo}, s. ${cur.c.bookPage} · ${cur.c.source}</div>
    <div class="gc-alg">${cur.c.alg}</div>
    <div class="gc-stats"><div><span class="muted small">Beste (drill)</span><b>${best}</b></div><div><span class="muted small">Median</span><b>${med}</b></div></div>`;
}

// ---------- resultatvindu ----------
function showOverlay() {
  const r = S.last, c = r.c;
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
      <div class="o-cmp"><div><span>Du gjorde</span><code>${r.did}</code></div>
      <div><span>Skal være – ${c.source === "låst" ? "din låste løsning" : c.source === "spor" ? `${c.slot}-sporet, avtalt løsning` : `boka s. ${c.bookPage}`}</span><code class="big">${c.alg}</code></div></div>
      <div class="o-keys"><span>Guidet <kbd>R4</kbd></span><span class="next">Prøv igjen <kbd>U</kbd></span></div>`;
  }
}
function hideOverlay() { $("overlay").className = ""; }

function sidebarResult() {
  const r = S.last;
  if (!r) return `<p class="muted">Ingen caser løst ennå.</p>`;
  const c = r.c;
  return `<div class="res">
    <div class="resrow"><b>${c.n}${c.slot !== "FR" ? " " + c.slot : ""}</b><span class="muted">bok ${c.bookNo}, s. ${c.bookPage}</span><span class="t">${fmt(r.exec)}</span></div>
    <div>${r.ok ? `<span class="good">Valgt løsning${r.fixed ? " (med retting)" : ""}</span>` : `<span class="badtxt">Annen løsning</span>`}${r.guided ? ' <span class="muted">(guidet)</span>' : ""}</div>
    <div class="muted">Gjenkjenning ${fmt(r.rec)} · utførelse ${fmt(r.exec)} · sum ${fmt(r.total)}</div>
  </div>`;
}

function statsHtml() {
  const keys = CASES.flatMap((c) => SLOTS.map((sl) => (sl === "FR" ? String(c.n) : `${c.n}@${sl}`))).filter((k) => S.stats[k] || S.hist[k]);
  const rows = keys.map((k) => {
    const c = { n: k.replace("@", " ") };
    const s = S.stats[k], h = S.hist[k] || {};
    const sess = s && s.exec.length ? median(s.exec.map((e, i) => e + s.rec[i])) : null;
    const f = (x) => (x != null ? fmt(x) : "–");
    return `<tr><td>${c.n}</td><td>${f(h.medianRec)}</td><td>${f(h.medianExec)}</td><td>${f(h.medianTotal)}</td><td>${f(h.best)}</td><td>${h.attempts ? `${h.ok}/${h.attempts}` : "–"}</td><td>${f(sess)}</td></tr>`;
  }).join("");
  if (!rows) return `<p class="muted small">Ingen data ennå.</p>`;
  return `<table><thead><tr><th>case</th><th>gjenk.</th><th>utf.</th><th>sum</th><th>beste</th><th>godkj.</th><th>økta</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="muted small">Median fra loggen siste 14 dager (lastet da pluginen startet; guidet teller ikke). «Økta» = sum gjenkjenning + utførelse i denne økta.</p>`;
}

function learnProgress() {
  const sel = selected(), done = sel.filter((n) => S.learn.learned.has(n)).length;
  const cur = learnCurrent();
  const r = cur != null ? (S.learn.recent[cur] || []).slice(-S.learn.meanOf) : [];
  const avg = r.length ? fmt(r.reduce((a, b) => a + b, 0) / r.length) : "–";
  return `<div class="radprog">Lært ${done} av ${sel.length}${cur != null ? ` · ny case: snitt av ${S.learn.meanOf} ${avg} / ${S.learn.threshold.toFixed(1)} s` : " · alle lært"}</div>`;
}

function render() {
  const cur = S.cur;
  const guided = S.mode === "guided";
  let main = "";
  if (S.phase === "idle") {
    main = `<div class="big">Velg minst én case.</div>`;
  } else if (S.mode === "predict") {
    main = S.predict.sub === "review" ? reviewPanel() : predictPanel();
  } else if (S.mode === "recog") {
    main = recogPanel();
  } else if (S.mode === "slow") {
    main = `${view3d ? "" : `<div class="cube">${cubeSvg(S.facelets, { dimLastLayer: false })}</div>`}${slowPanel()}`;
  } else {
    const timer = (S.phase === "result" || S.phase === "pause") && S.last ? fmt(S.last.exec) : cur.execStart != null ? fmt(performance.now() - cur.execStart) : "0.00";
    main = `${view3d ? "" : `<div class="cube">${cubeSvg(S.facelets, { colorMap: colorMapFor(cur.colorShift || 0) })}</div>`}
      <div id="timer" class="timer">${timer}</div>
      ${S.mode === "rad" && S.rad.queue.length ? `<div class="radprog">Case ${Math.min(S.rad.idx + 1, S.rad.queue.length)} av ${S.rad.queue.length} · ${"●".repeat(S.rad.streak)}${"○".repeat(Math.max(0, S.rad.n - S.rad.streak))}</div>` : ""}
      ${(guided || (cur.intro && S.mode === "learn")) && S.phase === "case" ? `${cur.intro ? `<div class="hint">Ny case – her er algoritmen</div>` : ""}${algHtml(cur)}` : ""}
      ${S.mode === "learn" ? learnProgress() : ""}
      ${S.mode === "recap" && S.recap.queue.length ? `<div class="radprog">${Math.min(S.recap.idx + 1, S.recap.queue.length)} av ${S.recap.queue.length}</div>` : ""}`;
  }
  $("phase").innerHTML = main;
  const still = S.mode === "recog" || (S.mode === "predict" && S.predict.sub !== "review"); // fast 2D-bilde
  $("stage").hidden = still;
  if (view3d) view3d.fixed = S.mode === "predict" || S.mode === "recog";
  $("retry").hidden = $("calib").hidden = S.mode === "recog" || S.mode === "predict";
  if (S.mode === "slow") $("retry").hidden = true;
  $("skip").textContent = S.mode === "slow" ? "Ny scramble" : "Neste case";
  $("mixll").parentElement.hidden = $("colorswap").parentElement.hidden = S.mode === "slow";
  document.querySelector('[data-mode="guided"]').disabled = S.mode === "recog" || S.mode === "predict" || S.mode === "slow";
  if ($("slow-skipcorr")) $("slow-skipcorr").onclick = slowSkipCorr;
  if ($("slow-guideafter")) $("slow-guideafter").onclick = () => { S.slow.guideAfter = !S.slow.guideAfter; render(); };
  if ($("slow-skipback")) $("slow-skipback").onclick = slowSkipBack;
  if ($("slow-guide")) $("slow-guide").onclick = () => { slowStartGuide(); render(); };
  if ($("p-yes")) { $("p-yes").onclick = () => predictAnswer(true); $("p-no").onclick = () => predictAnswer(false); }
  if ($("rv-play")) { $("rv-play").onclick = reviewPlay; $("rv-prev").onclick = () => reviewShow(-1); $("rv-next").onclick = () => reviewShow(1); $("rv-rand").onclick = () => reviewShow(0); }
  document.querySelectorAll("[data-auf]").forEach((b) => (b.onclick = () => answerAuf(+b.dataset.auf)));
  document.querySelectorAll("[data-name]").forEach((b) => (b.onclick = () => answerName(+b.dataset.name)));
  const rem = S.phase === "case" && cur ? rotateReminder(cur) : "";
  $("remind").innerHTML = rem;
  $("remind").classList.toggle("on", !!rem);
  $("main").classList.toggle("guided", guided && !!cur);
  $("gcard").innerHTML = guided && cur ? caseCard(cur) : "";
  if (view3d && S.phaseShown !== S.phase) { S.phaseShown = S.phase; view3d.redim(dimNow()); }
  $("result").innerHTML = sidebarResult();
  $("stats").innerHTML = statsHtml();
  $("sel-count").textContent = `${S.selection.size} valgt`;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
  const base = S.mode === "guided" ? S.baseMode : S.mode;
  for (const m of ["rad", "learn", "recap", "weighted", "recog", "predict", "slow"]) $(`${m}-opts`).hidden = base !== m;
  $("recog-name-opts").hidden = S.recog.sub !== "name";
  $("rad-n").value = String(S.rad.n); $("rad-order").value = S.rad.order;
}

function renderAlgs() {
  const f = (x) => (x != null ? fmt(x) : "–");
  $("algs").innerHTML = CASES.map((c) => {
    const h = S.hist[c.n] || {};
    const st = simplify(invert(expand(c.alg).moves)).reduce((s, m) => turn(s, m.face, m.amt), SOLVED);
    return `<button class="acard" data-alg="${c.n}">
      <div class="acard-h"><b>F2L ${c.n}</b><span class="muted small">bok ${c.bookNo}</span></div>
      <div class="acard-c">${cubeSvg(st)}</div>
      <div class="acard-s"><span>Median ${f(h.medianTotal)}</span><span>Beste ${f(h.best)}</span><span>${h.attempts ? `${h.ok}/${h.attempts}` : "ingen data"}</span></div>
    </button>`;
  }).join("");
}
function showAlg(n) {
  const c = CASE_BY_N[n], h = S.hist[n] || {};
  const f = (x) => (x != null ? fmt(x) : "–");
  $("algdetail").innerHTML = `<div class="ad-box">
    <div class="ad-h"><b>F2L ${c.n}</b><span class="muted">bok ${c.bookNo}, s. ${c.bookPage} · ${c.source === "låst" ? "din låste løsning" : "bokas algoritme"}</span><button id="ad-close">Lukk</button></div>
    <div class="ad-c">${cubeSvg(simplify(invert(expand(c.alg).moves)).reduce((s, m) => turn(s, m.face, m.amt), SOLVED))}</div>
    <div class="ad-alg">${c.alg}</div>
    ${c.source === "låst" ? `<div class="muted small">Boka: ${c.book}</div>` : ""}
    <table class="slottab">${SLOTS.filter((sl) => sl !== "FR").map((sl) => { const v = variant(n, sl); return `<tr><td>${sl}</td><td class="${v ? "" : "muted"}">${v ? v.alg : "ikke avtalt ennå"}</td></tr>`; }).join("")}</table>
    ${c.alts.length ? `<div class="muted small">Godtas også: ${c.alts.join(" · ")}</div>` : ""}
    <div class="ad-s">Gjenkjenning ${f(h.medianRec)} · utførelse ${f(h.medianExec)} · sum ${f(h.medianTotal)} · beste ${f(h.best)} · godkjent ${h.attempts ? `${h.ok}/${h.attempts}` : "–"}</div>
    <div class="ad-b"><button id="ad-guided">Øv guidet</button></div>
  </div>`;
  $("algdetail").hidden = false;
  $("ad-close").onclick = () => { $("algdetail").hidden = true; };
  $("ad-guided").onclick = () => {
    $("algdetail").hidden = true; $("algs-wrap").hidden = true;
    S.selection.add(n); S.repeat = n;
    if (S.mode !== "guided") { S.baseMode = S.mode; S.mode = "guided"; }
    startCase();
  };
}

function renderPicker() {
  $("slotbar").innerHTML = `<span class="muted small">Spor:</span>` + SLOTS.map((sl) => {
    const n = CASES.filter((c) => variant(c.n, sl)).length;
    return `<button class="slot ${S.slots.has(sl) ? "on" : ""}" data-slot="${sl}">${sl} <span class="muted small">${n}</span></button>`;
  }).join("") + `<span class="muted small">Grå caser har ingen avtalt løsning i de valgte sporene ennå.</span>`;
  $("picker").innerHTML = CASES.map((c) => {
    const sl = availSlots(c.n);
    const algs = sl.map((x) => `${sl.length > 1 || x !== "FR" ? x + ": " : ""}${variant(c.n, x).alg}`).join(" · ");
    return `<button class="case ${S.selection.has(c.n) && sl.length ? "on" : ""} ${sl.length ? "" : "na"}" data-n="${c.n}" title="${algs || "ikke avtalt"}" ${sl.length ? "" : "disabled"}>
      <span class="n">${c.n}</span><span class="b">bok ${c.bookNo}</span><span class="a">${algs || "ikke avtalt i valgte spor"}</span></button>`;
  }).join("");
}

// ---------- oppkobling ----------
function bind() {
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.mode;
    if (m === S.mode) return;
    // Fra guidet tilbake til samme modus = ut av guidet: samme case igjen, nå uten hjelp.
    if (m === "guided" || (S.mode === "guided" && m === S.baseMode)) toggleGuided(); else setMode(m);
  }));
  const num = (id, fn) => $(id).addEventListener("change", (e) => { fn(e.target.type === "checkbox" ? e.target.checked : e.target.value); render(); });
  num("learn-th", (v) => { S.learn.threshold = +v; learnInit(); });
  num("learn-mean", (v) => { S.learn.meanOf = +v; learnInit(); });
  num("learn-new", (v) => { S.learn.newChance = +v; });
  num("recap-rep", (v) => { S.recap.repeat = +v; buildRecap(); startCase(); });
  num("recap-inst", (v) => { S.recap.instant = v; buildRecap(); startCase(); });
  num("recap-order", (v) => { S.recap.order = v; buildRecap(); startCase(); });
  num("w-str", (v) => { S.weighted.strength = +v; });
  num("recog-sub", (v) => { S.recog.sub = v; startCase(); });
  num("recog-n", (v) => { S.recog.options = +v; startCase(); });
  num("recog-img", (v) => { S.recog.images = v; });
  num("pred-sub", (v) => { S.predict.sub = v; clearInterval(S.review.timer); startCase(); });
  num("pred-view", (v) => { S.predict.view = v; });
  num("pred-tps", (v) => { S.predict.tps = +v; });
  addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (S.phase === "recog" && S.recog.sub === "auf") {
      const k = { ArrowDown: 0, ArrowLeft: 1, ArrowUp: 2, ArrowRight: 3 }[e.key];
      if (k != null) { e.preventDefault(); answerAuf(k); }
    } else if (S.phase === "recog" && S.recog.sub === "name") {
      const n = S.recog.round.options[+e.key - 1];
      if (n != null) answerName(n);
    } else if (S.phase === "predict") {
      if (e.key === "ArrowLeft") predictAnswer(false); else if (e.key === "ArrowRight") predictAnswer(true);
    } else if (S.phase === "review") {
      if (e.key === "ArrowLeft") reviewShow(-1); else if (e.key === "ArrowRight") reviewShow(1); else if (e.key === " ") { e.preventDefault(); reviewPlay(); }
    }
  });
  $("toggle-algs").addEventListener("click", () => { $("algs-wrap").hidden = !$("algs-wrap").hidden; if (!$("algs-wrap").hidden) renderAlgs(); });
  $("algs").addEventListener("click", (e) => { const b = e.target.closest("[data-alg]"); if (b) showAlg(+b.dataset.alg); });
  $("rad-n").addEventListener("change", (e) => { S.rad.n = +e.target.value; S.rad.streak = 0; render(); });
  $("rad-order").addEventListener("change", (e) => { S.rad.order = e.target.value; if (S.mode === "rad") { buildRadQueue(); startCase(); } });
  $("mixll").addEventListener("change", (e) => { S.mixLL = e.target.checked; });
  $("colorswap").addEventListener("change", (e) => { S.colorSwap = e.target.checked; });
  $("toggle-picker").addEventListener("click", () => { $("picker-wrap").hidden = !$("picker-wrap").hidden; renderPicker(); });
  $("picker").addEventListener("click", (e) => {
    const b = e.target.closest(".case"); if (!b) return;
    const n = +b.dataset.n;
    S.selection.has(n) ? S.selection.delete(n) : S.selection.add(n);
    renderPicker(); if (S.phase === "idle") startCase(); else render();
  });
  $("slotbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-slot]"); if (!b) return;
    const sl = b.dataset.slot;
    if (S.slots.has(sl)) { if (S.slots.size > 1) S.slots.delete(sl); } else S.slots.add(sl);
    renderPicker(); setMode(S.baseMode);
  });
  $("sel-all").addEventListener("click", () => { CASES.forEach((c) => S.selection.add(c.n)); renderPicker(); if (S.phase === "idle") startCase(); else render(); });
  $("sel-none").addEventListener("click", () => { S.selection.clear(); renderPicker(); render(); });
  $("sel-asker").addEventListener("click", () => { S.selection = new Set(DEFAULT_SELECTION); renderPicker(); if (S.phase === "idle") startCase(); else render(); });
  $("planbar").addEventListener("click", (e) => {
    if (e.target.closest("#stopblock")) { endBlock(); return; }
    if (e.target.closest("#pauseblock")) { togglePause(); return; }
    const b = e.target.closest("[data-block]"); if (b) startBlock(b.dataset.block);
  });
  onStatus((st, n) => {
    $("logstatus").textContent = `Logg: ${st}${n ? ` (${n} venter)` : ""}`;
    $("pinbox").hidden = hasPin();
    if (!hasPin() && st.startsWith("feil kode")) $("pinmsg").textContent = "Feil kode – skriv den på nytt";
  });
  // Loggkoden: skrives inn ved hver oppstart (sandkassen kan ikke lagre den). Uten kode lagres ingenting.
  const tryPin = async () => {
    const code = $("pin").value.trim();
    if (!code) return;
    $("pinmsg").textContent = "sjekker …";
    const r = await setPin(code);
    $("pinmsg").textContent = r.ok ? "" : r.error;
    if (r.ok) { $("pin").value = ""; $("pin").blur(); flash("Logging på"); }
  };
  $("pin-ok").addEventListener("click", tryPin);
  $("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tryPin(); } });
  $("calib").addEventListener("click", () => { if (window.acubemy) acubemy.calibrateGyro(); });
  $("skip").addEventListener("click", () => { if (S.mode === "slow") { slowNewScramble(); render(); } else shortcut("next"); });
  num("slow-end", (v) => { S.slow.end = v; });
  $("slow-sync").addEventListener("click", () => { S.facelets = SOLVED; slowSynced("Satt til løst – ny scramble", true); });
  $("retry").addEventListener("click", () => { if (S.cur) startCase(true); });
}

// Bytt mellom F2L- og PLL-treneren. 3D-kuben flyttes med.
function switchTrainer(t) {
  if (t === S.trainer) return;
  S.trainer = t;
  document.querySelectorAll("[data-trainer]").forEach((b) => b.classList.toggle("on", b.dataset.trainer === t));
  $("f2l-ui").hidden = t !== "f2l";
  $("pll-ui").hidden = t !== "pll";
  document.querySelector("h1").textContent = t === "pll" ? "PLL-trener" : "F2L-trener";
  if (t === "pll") {
    if (S.block) endBlock();
    clearInterval(S.review.timer); S.review.timer = null;
    S.phase = "idle"; S.cur = null;
    PLL.activate();
  } else {
    PLL.deactivate();
    if (view3d) $("stage").prepend(view3d.container);
    startCase();
  }
}

async function boot() {
  bind();
  try {
    const { Cube3D } = await import("./view3d.js");
    view3d = new Cube3D($("cube3d"));
    view3d.set(S.facelets, false);
    view3d.container = $("cube3d");
  } catch (e) {
    console.warn("3D-visning utilgjengelig, bruker 2D", e);
    $("cube3d").hidden = true;
  }
  PLL.init({ view3d, beep, progressFor, mmss,
    onProgress: (e) => (S.blockLocal ||= []).push(e),
    onBlockDone: (id) => { (S.blockLocal ||= []).push({ kind: "end", block: id, t: new Date().toISOString() }); S.blocksDone.add(id); renderPlan(); } });
  document.querySelectorAll("[data-trainer]").forEach((b) => b.addEventListener("click", () => switchTrainer(b.dataset.trainer)));
  if (window.acubemy) {
    acubemy.onDeviceChange((d) => {
      $("device").textContent = d.connected ? d.deviceName || "Kube tilkoblet" : "Ingen kube – koble til i acubemy";
      $("device").className = d.connected ? "ok" : "warn";
    });
    acubemy.onGyro((q) => {
      if (!view3d) return;
      view3d.setGyro(q);
      if (S.trainer === "pll") {
        requestAnimationFrame(() => { const g = view3d.grip(); const k = g ? g.U + g.F : ""; if (k !== S.gripKey) { S.gripKey = k; PLL.onGrip(); } });
        return;
      }
      // Oppdater hint/påminnelse når kuben roteres, uten å vente på et trekk (og gyrolinja i slow solve).
      if (S.phase === "case" || S.mode === "slow") {
        requestAnimationFrame(() => {
          const g = view3d.grip();
          const k = g ? g.U + g.F : "";
          if (k !== S.gripKey) { S.gripKey = k; render(); }
        });
      }
    });
    acubemy.onMove(({ face, prime }) => onMove(face, prime ? 3 : 1));
    acubemy.onStateChange((f) => { if (S.trainer === "f2l" && S.mode === "slow") slowSync(f); });
  }
  if (!embedded) $("device").textContent = "Utenfor acubemy: tastene U R F D L B (Shift = mot klokka) simulerer kuben i kubens egen ramme";
  window.__sim = (mv) => { const f = mv[0]; const a = mv.includes("2") ? 2 : mv.includes("'") ? 3 : 1; for (let i = 0; i < (a === 2 ? 2 : 1); i++) onMove(f, a === 2 ? 1 : a); };
  window.__state = S;
  window.__switch = switchTrainer;
  window.__setGrip = (g) => { testGrip = g; };
  window.__slowSet = (f) => { S.facelets = f; slowSynced("test"); }; // for tester utenfor acubemy
  loadPlan();
  startCase();
  loadHist().then(() => { if (S.phase !== "idle") render(); }); // medianene kommer når loggen er lest
}

boot();
