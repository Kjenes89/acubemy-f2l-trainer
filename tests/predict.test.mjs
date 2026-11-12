// Predict: kjør rundegeneratoren slik appen gjør, og sjekk at ekte løser og falsk aldri løser.
import { SOLVED, turn, f2lSolved } from "../src/cube.js";
import { expand, invert, simplify } from "../src/alg.js";
import { CASES, LL_SCRAMBLERS } from "../src/cases.js";
const rnd = (n) => Math.floor(Math.random() * n);
let bad = 0;
for (let it = 0; it < 4000; it++) {
  const c = CASES[it % CASES.length], alg = expand(c.alg);
  const pre = [...expand(LL_SCRAMBLERS[rnd(LL_SCRAMBLERS.length)]).moves, { face: "D", amt: rnd(4) }];
  const genuine = it % 2 === 0;
  const build = (moves, k) => simplify([...pre, ...invert(moves), { face: "D", amt: k }]).reduce((st, m) => turn(st, m.face, m.amt), SOLVED);
  const solves = (st) => f2lSolved(alg.moves.reduce((x, m) => turn(x, m.face, m.amt), st));
  let before = build(alg.moves, 0);
  if (!genuine) { before = build(alg.moves, 1 + rnd(3)); for (let i = 0; solves(before) && i < 200; i++) { const d = CASES[rnd(CASES.length)]; before = build(expand(d.alg).moves, rnd(4)); } }
  if (solves(before) !== genuine) { bad++; if (bad < 5) console.log("FEIL", c.n, genuine); }
}
console.log(bad ? `${bad} feil` : "predict: 4000 runder – ekte løser alltid, falsk aldri");
process.exit(bad ? 1 : 0);
