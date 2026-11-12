import { expand, START_GRIP, rotateGrip } from "../src/alg.js";
import { Tracker, withPreAuf, sameSolution, didInYourGrip } from "../src/solve.js";
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log("FEIL:", msg); } };
// Utfør en algoritme «fysisk»: hvert kvarttrekk for seg, med grepet algoritmen forutsetter (eller et fast grep).
const perform = (alg, gripOf = (m) => m.grip) => expand(alg).moves.flatMap((m) =>
  Array.from({ length: m.amt === 2 ? 2 : 1 }, () => ({ face: m.face, amt: m.amt === 2 ? 1 : m.amt, grip: gripOf(m), grips: [gripOf(m)] })));
const alg3 = expand("y' R' U' R").moves;

ok(sameSolution(perform("y' R' U' R"), alg3), "med rotasjon godkjennes");
ok(!sameSolution(perform("y' R' U' R", () => START_GRIP), alg3), "F' U' F (uten rotasjon) avvises");
ok(didInYourGrip(perform("y' R' U' R", () => START_GRIP)) === "F' U' F", "uten rotasjon skrives F' U' F");
ok(didInYourGrip(perform("y' R' U' R")) === "y' R' U' R", "med rotasjon skrives y' R' U' R");

// Gyro som ligger etter: første trekk etter rotasjonen har gammelt grep først, riktig 120 ms senere.
const lag = perform("y' R' U' R"); lag[0].grips = [START_GRIP, lag[0].grip]; lag[0].grip = START_GRIP;
ok(sameSolution(lag, alg3), "gyro-etterslep på første trekk tåles");

// Feiltrekk som angres, AUF før og etter, U2 som to kvarttrekk
const a7 = "U' R U2 R' U2 R U' R'";
const withFix = [...perform("U' R"), ...perform("F F'"), ...perform("U2 R' U2 R U' R'")];
ok(sameSolution(withFix, expand(a7).moves), "angret feiltrekk godkjennes");
ok(sameSolution([...perform("U2"), ...perform(a7), ...perform("U")], expand(a7).moves), "AUF før/etter ignoreres");
ok(!sameSolution(perform("U' R U' R' U2 R U' R'"), expand(a7).moves), "annen trekkrekke avvises");
// Bokas mot låst løsning for case 8
ok(!sameSolution(perform("y' U R' U2 R U R' U2 R"), expand("y' U R' U2 R U2 R' U R").moves), "bok-8 er ikke låst-8");

// AUF slås sammen med algoritmens innledende U
const p = withPreAuf(1, expand("U2 R U R'").moves);
ok(p.aufAmt === 3 && p.items[0].auf && p.items[0].amt === 3 && p.hidden.has(0), "AUF 1 + U2 = U'");
ok(withPreAuf(2, expand("U2 R U R'").moves).aufAmt === 0, "AUF 2 + U2 = ingen");

// Tracker: riktig trekk, feil grep, feiltrekk + angre
const t = new Tracker(withPreAuf(0, alg3).items);
ok(!t.step("F", 3, START_GRIP) && t.correcting, "guidet: trekk i feil grep gir angre");
ok(t.step("F", 1, START_GRIP) && !t.correcting, "angre fjerner rettingen");
const yp = rotateGrip(START_GRIP, "y", 3);
ok(t.step("F", 3, yp) && t.items.length === 2, "riktig grep går videre");
console.log(fail ? `${fail} feil` : "solve: alle kontroller ok");
process.exit(fail ? 1 : 0);
