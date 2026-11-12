// Sporalgoritmene: oppsettet bryter F2L, algoritmen løser, og bare målsporet er berørt.
import { SOLVED, turn, f2lSolved, heldFaces } from "../src/cube.js";
import { expand, invert } from "../src/alg.js";
import { SLOT_ALGS, variant, CASES } from "../src/cases.js";
let bad = 0, n = 0;
const run = (st, ms) => ms.reduce((s, m) => turn(s, m.face, m.amt), st);
// Hvilke spor er uløst? Sjekk midt- og bunnlagets klistremerker i grepet (hvit ned, grønn foran).
const broken = (st) => {
  const h = heldFaces(st), out = new Set();
  const okSticker = (f, i) => h[f][i] === h[f][4];
  const slotStickers = { FR: [["F", 5], ["F", 8], ["R", 3], ["R", 6], ["D", 2]], FL: [["F", 3], ["F", 6], ["L", 5], ["L", 8], ["D", 0]],
    BR: [["B", 3], ["B", 6], ["R", 5], ["R", 8], ["D", 8]], BL: [["B", 5], ["B", 8], ["L", 3], ["L", 6], ["D", 6]] };
  for (const [sl, ss] of Object.entries(slotStickers)) if (!ss.every(([f, i]) => okSticker(f, i))) out.add(sl);
  return out;
};
for (const [slot, algs] of Object.entries(SLOT_ALGS)) for (const [num, alg] of Object.entries(algs)) {
  n++;
  const mv = expand(alg).moves, st = run(SOLVED, invert(mv)), b = broken(st);
  const ok = !f2lSolved(st) && f2lSolved(run(st, mv)) && b.size === 1 && b.has(slot) && variant(+num, slot).alg === alg;
  if (!ok) { bad++; console.log("FEIL", num, slot, alg, [...b]); }
}
// FR-casene bryter bare FR
for (const c of CASES) { const b = broken(run(SOLVED, invert(expand(c.alg).moves))); if (!(b.size === 1 && b.has("FR"))) { bad++; console.log("FEIL FR", c.n, [...b]); } }
console.log(bad ? `${bad} feil` : `spor: ${n} sporalgoritmer + 41 FR ok`);
process.exit(bad ? 1 : 0);
