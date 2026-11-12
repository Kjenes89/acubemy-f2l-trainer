// Slow solve: vanlige løsninger på den fysiske kuben, der hvert F2L-par vurderes mot avtalt løsning.
// Ren logikk (ingen DOM), testet i tests/slowsolve.test.mjs.
// Alt regnes i kubens sensorramme (hvit = U, grønn = F, rød = R). Krysset er hvitt (sensor U),
// og Vegard løser med hvit ned, så «U» i grepet er sensor D.
import { SOLVED, STICKERS, OPPOSITE, turn, applyMoves } from "./cube.js";
import { expand, invert, simplify, START_GRIP, rotateGrip, yNeeded, SENSOR_TO_HELD } from "./alg.js";
import { CASES, CASE_BY_N, variant } from "./cases.js";
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

// ---------- scramble (krysset står) ----------
// Bare «innsettinger» X U^m X' (X = en sideflate, U = gul = sensor D) og U-trekk: krysset røres aldri,
// så scramblen virker fra enhver tilstand der krysset står. Scramblen vises slik du holder kuben (hvit ned).
const SIDES = ["F", "R", "B", "L"];
const pick = (xs, rand) => xs[Math.floor(rand() * xs.length)];
function triggers(faces, count, rand) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = pick(faces, rand), d = rand() < 0.5 ? 1 : 3, m = 1 + Math.floor(rand() * 3);
    out.push({ face: "D", amt: Math.floor(rand() * 4) }, { face: x, amt: d }, { face: "D", amt: m }, { face: x, amt: 4 - d });
  }
  return out;
}

/** Scramble med løst kryss, uten bestemt case (når F2L ikke står fra før). */
export function makeCrossScramble(rand = Math.random) {
  return simplify(triggers(SIDES, 8, rand));
}

/**
 * Scramble som gir en bestemt case (n) i et bestemt spor, med de tre andre parene og siste lag blandet.
 * Krever at F2L står når scramblen starter (det gjør den etter forrige slow solve med «til og med F2L»).
 * Sporet er et av de fire sensorsporene; de andre parene blandes bare med de to sideflatene som ikke rører
 * målsporet, og til slutt settes casen opp med invers av bokas FR-algoritme (etter y-rotasjon til sporet).
 */
export function makeTargetScramble(n, slot, rand = Math.random) {
  const c = CASES.find((x) => x.n === n);
  const free = SIDES.filter((f) => f !== slot[0] && f !== slot[1]);
  for (const rot of ["", "y ", "y2 ", "y' "]) {
    const setup = invert(expand(rot + c.book).moves);
    const st = applyMoves(SOLVED, setup);
    if (SENSOR_SLOTS.filter((sl) => !slotSolved(st, sl)).join() !== slot) continue;
    // Noen innsettinger etter oppsettet også, så casen ikke kan leses av slutten på scramblen.
    // De kan dra en målbrikke ut av U-laget; da trekkes det på nytt.
    for (let i = 0; i < 300; i++) {
      const seq = simplify([...triggers(free, 4, rand), ...setup, ...triggers(free, 3, rand), { face: "D", amt: Math.floor(rand() * 4) }]);
      if (caseOf(applyMoves(SOLVED, seq), slot) === n) return seq;
    }
    return simplify([...triggers(free, 6, rand), ...setup, { face: "D", amt: Math.floor(rand() * 4) }]);
  }
  throw new Error("fant ikke sporet " + slot);
}

export const moveName = (m) => m.face + (m.amt === 2 ? "2" : m.amt === 3 ? "'" : "");
/** Trekket slik du holder kuben (hvit ned, grønn foran). */
export const heldName = (m) => moveName({ face: SENSOR_TO_HELD[m.face], amt: m.amt });

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

// FR-løsningen (og alternativene) flyttet til et annet spor uten rotasjon: R/F/L/B byttes som om sporet
// sto i FR. Kontrollert i simulator 12.11.: gir riktig case i riktig spor for alle 41 i FL, BL og BR.
const CYC = ["F", "R", "B", "L"];
const SHIFT = { FR: 0, BR: 1, BL: 2, FL: 3 };
export const relabel = (alg, k) => alg.replace(/[FRBLfrbl]/g, (c) => {
  const up = c.toUpperCase(), r = CYC[(CYC.indexOf(up) + k) % 4];
  return c === up ? r : r.toLowerCase();
});
export function slotCopies(n, held) {
  const c = CASE_BY_N[n];
  if (!c || !(held in SHIFT) || held === "FR") return [];
  // Bare løsninger uten rotasjon: en kopi med y' ville ellers gjøre F' U' F lik y' R' U' R (gyroen ser bare
  // sluttgrepet), og du skal bare rotere der boka roterer.
  return [c.alg, ...(c.alts || [])].filter((a) => !/[xyz]/.test(a)).map((a) => relabel(a, SHIFT[held]));
}

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
  const heldAt = (k) => new Set([...gripsOf(moves[k]), ...(gripsOf(moves[k]).length ? [] : [startGrip])].map((g) => heldSlot(slot, g)).filter(Boolean));
  const candGrips = (k) => withY([startGrip, ...moves.slice(0, k + 1).flatMap(gripsOf)]);
  const optionsFor = (n, g) => {
    const held = heldSlot(slot, g);
    const v = held && variant(n, held);
    if (v) return { held, v, algs: [v.alg, ...(v.alts || [])], loose: !!v.loose };
    // Uten egen sporløsning: FR-løsningen flyttet til sporet (samme trekk sett fra sporet, f.eks. 1 i BL =
    // U L U' L') godkjennes som riktig, men gir ingen alarm (v = null). Jf. «én løsning per case, alle spor» 31.10.
    return { held, v: null, algs: held ? slotCopies(n, held) : [], copy: true };
  };
  {
    const n = caseOf(states[j], slot);
    for (const g of candGrips(j)) {
      const { held, algs } = optionsFor(n, g);
      for (const a of algs) {
        const strict = strictGrip(a) && !optionsFor(n, g).loose; // egne løsninger med fri rotasjon: bare resultatet teller
        if (!strict && !heldAt(j).has(held)) continue; // grepet kontrolleres ikke trekk for trekk, så sporet må være det du faktisk holdt
        if (sameSolution(moves.slice(j), expand(a, g).moves, { strictGrip: strict })) return { verdict: "ok", n, held, alg: a, from: j, copy: !optionsFor(n, g).v || undefined };
      }
    }
  }
  const n = caseOf(states[j], slot);
  // Multislotting: trekk før innsettingen godtas når de ikke dreier noen av sidene til dette sporet
  // (bare U og andre spor, f.eks. et ledig spor brukt til å sette sammen paret). Da må innsettingen være
  // avtalt løsning for casen paret står som når den starter – også om casen er endret av de trekkene.
  // Dreier trekkene sporets egne sider (som R U' R' først på 9), er det en annen løsning og fortsatt feil.
  const slotFaces = new Set(slot.split(""));
  for (let k = j + 1; k < moves.length; k++) {
    if (slotFaces.has(moves[k - 1].face)) break; // fra her har sporets egne sider vært dreid
    const nk = moves[k].face === "D" || !crossSolved(states[k]) ? null : caseOf(states[k], slot);
    if (nk == null) continue;
    for (const g of candGrips(k)) {
      const { held, algs } = optionsFor(nk, g);
      for (const a of algs) {
        const strict = strictGrip(a) && !optionsFor(nk, g).loose;
        if (!strict && !heldAt(k).has(held)) continue;
        if (sameSolution(moves.slice(k), expand(a, g).moves, { strictGrip: strict })) return { verdict: "ok", n: nk, held, alg: a, from: k, multislot: nk !== n ? n : undefined };
      }
    }
  }
  const gripAtJ = gripsOf(moves[j])[0] || startGrip;
  const did = didInYourGrip(moves.slice(j), gripAtJ || START_GRIP);
  const undo = simplify(invert(moves.slice(j)));
  // Sporet er det du holdt kuben i ved første trekk i casen. Feil bare når det finnes en avtalt løsning der;
  // ellers ikke avtalt – med forslag (rotasjon + avtalt løsning), men uten alarm. (Før ble også grep fra
  // tidligere i segmentet og rotasjoner underveis brukt, så 17 løst fra FL kunne bli vurdert som BL.)
  const seen = uniqGrips([gripAtJ || startGrip]);
  for (const g of seen) {
    const { held, v } = optionsFor(n, g);
    if (v) return { verdict: "feil", n, held, alg: v.alg, grip: g, slot, did, undo, from: j };
  }
  for (const g of withY([gripAtJ])) {
    const { held, v } = optionsFor(n, g);
    if (v) return { verdict: "ikke-avtalt", n, held: heldSlot(slot, gripAtJ), did, from: j, hint: { rot: yNeeded(gripAtJ, g), held, alg: v.alg } };
  }
  return { verdict: "ikke-avtalt", n, held: heldSlot(slot, gripAtJ), did, from: j };
}
