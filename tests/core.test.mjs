import { SOLVED, turn, applyMoves, f2lSolved, heldFaces } from "../src/cube.js";
import { expand, invert, simplify, canonical } from "../src/alg.js";
import { CASES, LL_SCRAMBLERS } from "../src/cases.js";
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log("FEIL:", msg); } };

// 1. Kubemodell
ok(turn(SOLVED, "R") === "UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB", "R fra løst");
for (const f of "URFDLB") ok(turn(SOLVED, f, 4) === SOLVED, f + "4");
const sexy = expand("R U R' U'").moves;
let s = SOLVED; for (let i = 0; i < 6; i++) s = applyMoves(s, sexy);
ok(s === SOLVED, "(R U R' U')6 = id");
const t = expand("R U R' U' R' F R2 U' R' U' R U R' F'").moves;
ok(applyMoves(applyMoves(SOLVED, t), t) === SOLVED && applyMoves(SOLVED, t) !== SOLVED, "T-perm orden 2");
ok(applyMoves(SOLVED, expand("x y z x' y' z' y2 x2").moves) === SOLVED, "rotasjoner gir ingen trekk");

// 2. Grep: hvit ned, grønn foran. Grep-R løfter F-klistremerker opp i grep-U høyre kolonne.
const h = heldFaces(applyMoves(SOLVED, expand("R").moves));
ok([2, 5, 8].every((i) => h.U[i] === "F") && h.U[0] === "D", "grep-R: grønt opp i høyre kolonne av gul topp");
const h0 = heldFaces(SOLVED);
ok(h0.U.every((c) => c === "D") && h0.F.every((c) => c === "F") && h0.R.every((c) => c === "L"), "grep: gul topp, grønn front, oransje høyre");

// 3. Brede trekk og slices = samme tilstand som flatetrekk + rotasjon
ok(applyMoves(SOLVED, expand("r U r'").moves) === applyMoves(SOLVED, expand("L x U x' L'").moves), "r = L x");
ok(applyMoves(SOLVED, expand("M U M'").moves) === applyMoves(SOLVED, expand("R L' x' U x L R'").moves), "M = R L' x'");
ok(canonical(expand("y' R' U' R").moves) === canonical(expand("F' U' F").moves), "y' R' = F' (sammenligning uten rotasjon)");
ok(canonical(expand("R L'").moves) === canonical(expand("L' R").moves), "motstående par i fast rekkefølge");

// 4. Alle 41 caser: oppsett = invers valgt alg; F2L brutt, valgt alg løser, bokas alg løser samme case
for (const c of CASES) {
  const alg = expand(c.alg).moves;
  const setup = invert(alg);
  for (const ll of [null, ...LL_SCRAMBLERS]) {
    const pre = ll ? expand(ll).moves : [];
    const st = applyMoves(SOLVED, simplify([...pre, ...setup]));
    if (f2lSolved(st)) { ok(false, `case ${c.n}: F2L løst etter oppsett`); break; }
    ok(f2lSolved(applyMoves(st, alg)), `case ${c.n}: valgt alg løser ikke (LL ${ll})`);
  }
  const st = applyMoves(SOLVED, setup);
  const bookSolves = [0, 1, 2, 3].some((k) => f2lSolved(applyMoves(applyMoves(st, k ? [{ face: "D", amt: k }] : []), expand(c.book).moves)));
  ok(bookSolves, `case ${c.n}: bokas alg løser ikke samme case`);
  for (const a of c.alts) ok([0, 1, 2, 3].some((k) => f2lSolved(applyMoves(applyMoves(st, k ? [{ face: "D", amt: k }] : []), expand(a).moves))), `case ${c.n}: alternativ ${a}`);
}
// 5. Ingen to caser har samme oppsett-tilstand (opp til AUF) – casene er ulike
const sig = new Set();
for (const c of CASES) {
  const st = applyMoves(SOLVED, invert(expand(c.alg).moves));
  const v = [0, 1, 2, 3].map((k) => applyMoves(st, k ? [{ face: "D", amt: k }] : []).replace(/./g, (ch, i) => (i >= 27 && i < 36 ? "." : ch))).sort()[0];
  ok(!sig.has(v), `case ${c.n}: duplikat`); sig.add(v);
}
console.log(fail ? `${fail} feil` : "alle kontroller ok (" + CASES.length + " caser)");
process.exit(fail ? 1 : 0);
