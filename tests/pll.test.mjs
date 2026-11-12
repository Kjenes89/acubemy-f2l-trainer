// PLL: hver algoritme er en ren PLL (F2L og OLL urørt), oppsettet med pre-/post-AUF løses av algoritmen,
// og sammenligningen godtar algoritmen (fra alle fire y-startgrep) og avviser en annen PLL-algoritme.
import { SOLVED, turn, applyMoves } from "../src/cube.js";
import { expand, invert, START_GRIP, rotateGrip } from "../src/alg.js";
import { sameSolution } from "../src/solve.js";
import { PLLS } from "../src/pllcases.js";
import { makeInstance, judge } from "../src/pll.js";
let bad = 0, n = 0;
const check = (c, m) => { n++; if (!c) { bad++; console.log("FEIL", m); } };
for (const c of PLLS) {
  const mv = expand(c.exec).moves;
  const st = applyMoves(SOLVED, invert(mv));
  // ren PLL: gul flate (sensor D) er gul, og de to nederste radene på sidene er løst
  check(st.slice(27, 36) === "DDDDDDDDD", `${c.name}: OLL ikke bevart`);
  for (const f of [9, 18, 36, 45]) check(st.slice(f, f + 6) === SOLVED.slice(f, f + 6), `${c.name}: F2L ikke bevart`);
  check(st !== SOLVED, `${c.name}: gjør ingenting`);
  for (let i = 0; i < 8; i++) {
    const inst = makeInstance(c);
    const ex = [...(inst.pre ? [{ face: "D", amt: inst.pre, grip: START_GRIP }] : []), ...mv.map((m) => ({ ...m })), ...(inst.post ? [{ face: "D", amt: inst.post, grip: START_GRIP }] : [])];
    check(applyMoves(inst.state, ex) === SOLVED, `${c.name}: løser ikke oppsettet`);
    check(judge(c, ex.map((m) => ({ ...m, grips: [m.grip] }))), `${c.name}: egen algoritme avvist`);
  }
  // samme algoritme gjort fra et annet y-grep (AUF med rotasjon) godtas
  for (let k = 1; k < 4; k++) {
    const g = rotateGrip(START_GRIP, "y", k);
    const ex = expand(c.exec, g).moves.map((m) => ({ ...m, grips: [m.grip] }));
    check(judge(c, ex), `${c.name}: y${k} avvist`);
  }
}
// en annen algoritme for samme case avvises (T-perm gjort som Jb + ... nei: Jb sin algoritme brukt på Ja-casen gir ikke løst; test i stedet en kjent alternativ T-perm)
const T = PLLS.find((c) => c.name === "T");
const altT = expand("R U R' U' R' F R2 U' R' U' R U R' F'").moves; // samme som Vegards → godtas
check(judge(T, altT.map((m) => ({ ...m, grips: [m.grip] }))), "T samme");
const otherT = expand("R2 U R2 U' R2 U' D R2 U' R2 U R2 D'").moves; // annen sekvens (ikke T) → avvises
check(!judge(T, otherT.map((m) => ({ ...m, grips: [m.grip] }))), "T annen godtatt");
// F' i stedet for y-rotasjon midt i V avvises (grep)
const V = PLLS.find((c) => c.name === "V");
const vNoRot = expand(V.exec).moves.map((m) => ({ ...m, grip: START_GRIP, grips: [START_GRIP] }));
check(!judge(V, vNoRot), "V uten rotasjon godtatt");
console.log(bad ? `${bad} av ${n} feil` : `pll: ${n} kontroller ok`);
process.exit(bad ? 1 : 0);
