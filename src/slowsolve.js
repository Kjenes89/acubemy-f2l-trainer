// Slow solve: vanlige løsninger på den fysiske kuben, der hvert F2L-par vurderes mot avtalt løsning.
// Ren logikk (ingen DOM), testet i tests/slowsolve.test.mjs.
// Alt regnes i kubens sensorramme (hvit = U, grønn = F, rød = R). Krysset er hvitt (sensor U),
// og Vegard løser med hvit ned, så «U» i grepet er sensor D.
import { SOLVED, STICKERS, OPPOSITE, turn, applyMoves } from "./cube.js";
import { expand, invert, simplify, START_GRIP, rotateGrip, yNeeded } from "./alg.js";
import { CASES, variant } from "./cases.js";
import { sameSolution, didInYourGrip } from "./solve.js";

// ---------- brikker ----------
const byPos = new Map();
STICKERS.forEach((s, i) => { const k = s.pos.join(","); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(i); });
const PIECES = [...byPos.values()].filter((ix) => ix.length > 1); // 8 hjørner + 12 kanter

/** Hvor står brikken med disse fargene, og hvordan er den vridd? (indeksene til fargene i rekkefølge) */
function locate(f, colors) {
  const want = [...colors].sort().join("");
  for (const ix of PIECES) {
    if (ix.length !== colors.length) continue;
    if (ix.map((i) => f[i]).sort().join("") !== want) continue;
    return colors.map((c) => ix.find((i) => f[i] === c)).join(".");
  }
  return "?";
}

// Sporene i sensorrammen: hjørne U+a+b og kant a+b (a ∈ F/B, b ∈ R/L).
export const SENSOR_SLOTS = ["FR", "FL", "BR", "BL"];
export const pairSig = (f, slot) => `${locate(f, ["U", slot[0], slot[1]])}|${locate(f, [slot[0], slot[1]])}`;
const SOLVED_SIG = Object.fromEntries(SENSOR_SLOTS.map((s) => [s, pairSig(SOLVED, s)]));
export const slotSolved = (f, slot) => pairSig(f, slot) === SOLVED_SIG[slot];
export const solvedSlots = (f) => new Set(SENSOR_SLOTS.filter((s) => slotSolved(f, s)));
const CROSS = ["F", "R", "B", "L"].map((x) => ["U", x]);
const CROSS_SOLVED = CROSS.map((c) => locate(SOLVED, c)).join(" ");
export const crossSolved = (f) => CROSS.map((c) => locate(f, c)).join(" ") === CROSS_SOLVED;

// ---------- casetabell: parets plassering → case (alle fire spor, alle fire AUF-er) ----------
// Casen er definert relativt til sporet (samme som pluginens sporvarianter), så tabellen lages ved å
// sette opp bokas FR-algoritme etter y, y2 og y' og lese hvilket spor som ble brutt.
export const CASE_TABLE = Object.fromEntries(SENSOR_SLOTS.map((s) => [s, new Map()]));
for (const c of CASES) {
  for (const rot of ["", "y ", "y2 ", "y' "]) {
    const st = applyMoves(SOLVED, invert(expand(rot + c.book).moves));
    const broken = SENSOR_SLOTS.filter((s) => !slotSolved(st, s));
    if (broken.length !== 1) throw new Error(`casetabell: case ${c.n} ${rot}bryter ${broken.length} spor`);
    for (let d = 0; d < 4; d++) {
      const sig = pairSig(turn(st, "D", d), broken[0]);
      const old = CASE_TABLE[broken[0]].get(sig);
      if (old != null && old !== c.n) throw new Error(`casetabell: ${c.n} og ${old} gir samme tilstand`);
      CASE_TABLE[broken[0]].set(sig, c.n);
    }
  }
}
export const caseOf = (f, slot) => CASE_TABLE[slot].get(pairSig(f, slot)) ?? null;

/** Sensorsporet sett i et grep: «FR» betyr foran-høyre slik du holder kuben. null = ikke hvit ned. */
export function heldSlot(slot, grip) {
  if (!grip || grip.U !== "D") return null;
  const held = (x) => Object.keys(grip).find((k) => grip[k] === x);
  const hs = [held(slot[0]), held(slot[1])];
  const fb = hs.find((h) => h === "F" || h === "B"), rl = hs.find((h) => h === "R" || h === "L");
  return fb && rl ? fb + rl : null;
}

// ---------- scramble ----------
/** Tilfeldig trekk-scramble (25 trekk, ingen like/motstående flater som kan slås sammen). Sensorramme = WCA-orientering. */
export function makeScramble(len = 25, rand = Math.random) {
  const out = [];
  while (out.length < len) {
    const face = "URFDLB"[Math.floor(rand() * 6)];
    const a = out[out.length - 1], b = out[out.length - 2];
    if (a && a.face === face) continue;
    if (a && b && OPPOSITE[a.face] === face && b.face === face) continue;
    out.push({ face, amt: 1 + Math.floor(rand() * 3) });
  }
  return out;
}
export const moveName = (m) => m.face + (m.amt === 2 ? "2" : m.amt === 3 ? "'" : "");

// ---------- vurdering av ett par ----------
const strictGrip = (a) => !/[rludfbMES]|w/.test(a);
const gripsOf = (m) => (m.grips && m.grips.length ? m.grips : m.grip ? [m.grip] : []);
const uniqGrips = (list) => {
  const seen = new Map();
  for (const g of list) if (g && !seen.has(g.U + g.F)) seen.set(g.U + g.F, g);
  return [...seen.values()];
};
// Grepet + de tre andre y-rotasjonene av det: sporvalget («roter så paret er foran-høyre») og algoritmens
// egen rotasjon kan skje uten trekk imellom, så gyroen ser bare sluttgrepet. Grepet ved hvert trekk må
// likevel stemme med algoritmen, så dette godtar ikke F' U' F for y' R' U' R.
const withY = (list) => uniqGrips(list.filter(Boolean).flatMap((g) => [0, 1, 2, 3].map((t) => rotateGrip(g, "y", t))));

/**
 * Et par ble satt inn i `slot` (sensorspor). `start` = tilstanden da segmentet startet, `moves` = trekkene
 * siden (med grep fra gyroen), `startGrip` = grepet da segmentet startet.
 * Svar: { verdict: "ok" | "feil" | "ikke-avtalt" | "ikke-vurdert", n, held, alg, did, undo, from }
 *  - ok: trekkene fra et punkt der paret sto som en av de 41 casene er den avtalte løsningen
 *    (i sporet slik du holdt kuben da du startet den, med rotasjonene den har).
 *  - feil: paret sto som en kjent case, det finnes en avtalt løsning i det sporet, og du gjorde noe annet.
 *    undo = trekkene som tar kuben tilbake til før algoritmen (sensorramme).
 *  - ikke-avtalt: ingen avtalt løsning for casen i sporet du løste den i.
 *  - ikke-vurdert: paret sto aldri som en av de 41 casene (f.eks. en brikke i feil spor).
 */
export function judgePair({ start, moves, slot, startGrip = null }) {
  const states = [start];
  for (const m of moves) states.push(turn(states[states.length - 1], m.face, m.amt));
  const firstNonD = moves.findIndex((m) => m.face !== "D");
  if (firstNonD < 0) return { verdict: "ikke-vurdert" };
  // Der casen starter: første trekk (ikke U) der krysset står og paret er en av de 41 casene. Midt i en
  // innsetting eller et uttak er krysset brutt (R, F osv. dreier en krysskant), så et uttak av en brikke
  // fra feil spor regnes ferdig før casen starter. Bare dette punktet teller – ellers ville «sett opp til en
  // annen case og løs den» (gamle løsninger) bli godkjent.
  let j = -1;
  for (let k = firstNonD; k < moves.length && j < 0; k++) {
    if (moves[k].face !== "D" && crossSolved(states[k]) && caseOf(states[k], slot) != null) j = k;
  }
  if (j < 0) return { verdict: "ikke-vurdert" };
  const candGrips = (k) => withY([startGrip, ...moves.slice(0, k + 1).flatMap(gripsOf)]);
  const optionsFor = (n, g) => {
    const held = heldSlot(slot, g);
    const v = held && variant(n, held);
    return v ? { held, v, algs: [v.alg, ...(v.alts || [])] } : { held, v: null, algs: [] };
  };
  {
    const n = caseOf(states[j], slot);
    for (const g of candGrips(j)) {
      const { held, algs } = optionsFor(n, g);
      for (const a of algs) {
        if (sameSolution(moves.slice(j), expand(a, g).moves, { strictGrip: strictGrip(a) })) return { verdict: "ok", n, held, alg: a, from: j };
      }
    }
  }
  const n = caseOf(states[j], slot);
  const gripAtJ = gripsOf(moves[j])[0] || startGrip;
  const did = didInYourGrip(moves.slice(j), gripAtJ || START_GRIP);
  const undo = simplify(invert(moves.slice(j)));
  // Feil bare når det finnes en avtalt løsning i sporet slik du faktisk holdt kuben (ved start eller underveis).
  // Ellers: ikke avtalt – med forslag (rotasjon + avtalt løsning), men uten alarm.
  const seen = uniqGrips([gripAtJ, ...moves.slice(0, j + 1).flatMap(gripsOf).reverse(), startGrip]);
  for (const g of seen) {
    const { held, v } = optionsFor(n, g);
    if (v) return { verdict: "feil", n, held, alg: v.alg, did, undo, from: j };
  }
  for (const g of withY([gripAtJ])) {
    const { held, v } = optionsFor(n, g);
    if (v) return { verdict: "ikke-avtalt", n, held: heldSlot(slot, gripAtJ), did, from: j, hint: { rot: yNeeded(gripAtJ, g), held, alg: v.alg } };
  }
  return { verdict: "ikke-avtalt", n, held: heldSlot(slot, gripAtJ), did, from: j };
}
