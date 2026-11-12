// Slow solve: casetabell, vurdering av par mot avtalt løsning, retting tilbake.
import { SOLVED, turn, applyMoves } from "../src/cube.js";
import { expand, invert, START_GRIP, rotateGrip } from "../src/alg.js";
import { CASES, SLOT_ALGS, CASE_BY_N, variant } from "../src/cases.js";
import { judgePair, CASE_TABLE, caseOf, solvedSlots, crossSolved, makeCrossScramble, makeTargetScramble, heldSlot, SENSOR_SLOTS } from "../src/slowsolve.js";
import { f2lSolved } from "../src/cube.js";
let bad = 0, n = 0;
const check = (cond, msg) => { n++; if (!cond) { bad++; console.log("FEIL", msg); } };
const withG = (ms) => ms.map((m) => ({ ...m, grips: [m.grip] }));
const newly = (a, b) => [...solvedSlots(b)].filter((s) => !solvedSlots(a).has(s));

// Tabellen: 41 caser × 4 AUF per spor (37–41: paret i sporet, AUF gir samme tilstand).
for (const s of SENSOR_SLOTS) check(new Set(CASE_TABLE[s].values()).size === 41, `tabell ${s}: ${new Set(CASE_TABLE[s].values()).size}`);

// 1) Alle FR-løsninger og sporløsninger godkjennes, med og uten AUF foran, og i riktig spor.
const cases = [...CASES.map((c) => [c.n, "FR", c.alg]), ...CASES.flatMap((c) => c.alts.map((a) => [c.n, "FR", a])),
  ...Object.entries(SLOT_ALGS).flatMap(([sl, o]) => Object.entries(o).map(([k, a]) => [+k, sl, a]))];
for (const [num, sl, alg] of cases) for (const auf of [0, 1, 2, 3]) {
  const mv = withG(expand(alg).moves);
  const pre = auf ? [{ face: "D", amt: (4 - auf) % 4, grip: START_GRIP, grips: [START_GRIP] }] : [];
  const start = turn(applyMoves(SOLVED, invert(mv)), "D", auf);
  const end = applyMoves(start, [...pre, ...mv]);
  const nw = newly(start, end);
  check(nw.length === 1, `${num}${sl} ${alg}: nye spor ${nw}`);
  const r = judgePair({ start, moves: [...pre, ...mv], slot: nw[0], startGrip: START_GRIP });
  check(r.verdict === "ok" && r.n === num && r.held === sl, `${num}${sl} auf${auf} ${alg}: ${JSON.stringify(r)}`);
}

// 2) Samme trekk uten rotasjonen (F' U' F i stedet for y' R' U' R) → feil, med retting tilbake til casen.
{
  const c = CASE_BY_N[3]; // bokas y' R' U' R
  const mv = expand(c.alg).moves.map((m) => ({ ...m, grip: START_GRIP, grips: [START_GRIP] }));
  const start = applyMoves(SOLVED, invert(mv));
  const r = judgePair({ start, moves: mv, slot: "FL", startGrip: START_GRIP });
  check(r.verdict === "feil" && r.n === 3 && r.held === "FR" && r.alg === c.alg, `case 3 uten y': ${JSON.stringify(r)}`);
  check(applyMoves(applyMoves(start, mv), r.undo) === start, "retting tilbake til casen");
}

// 3) En annen løsning enn den avtalte (R U R' U' først, så løsningen på casen det ble) → feil.
for (const num of [7, 9, 16, 33]) {
  const st = applyMoves(SOLVED, invert(expand(CASE_BY_N[num].alg).moves));
  const pre = withG(expand("R U R' U'").moves);
  const mid = applyMoves(st, pre), n2 = caseOf(mid, "FL");
  if (n2 == null) { console.log("(test 3: ikke basic etter oppsett)", num); continue; }
  const auf = [0, 1, 2, 3].find((k) => solvedSlots(applyMoves(turn(mid, "D", k), expand(CASE_BY_N[n2].alg).moves)).has("FL"));
  const other = [...pre, ...(auf ? [{ face: "D", amt: auf, grip: START_GRIP, grips: [START_GRIP] }] : []), ...withG(expand(CASE_BY_N[n2].alg).moves)];
  const nw = newly(st, applyMoves(st, other));
  const r = judgePair({ start: st, moves: other, slot: nw[0], startGrip: START_GRIP });
  check(nw[0] === "FL" && r.verdict === "feil" && r.n === num && r.alg === CASE_BY_N[num].alg && applyMoves(applyMoves(st, other), r.undo) === st,
    `${num} via ${n2}: ${JSON.stringify(r)}`);
}

// 4) Paret i et annet spor: roter y2 og bruk FR-løsningen → ok, og sporet sett fra start er BL.
for (const c of CASES) {
  const mv = withG(expand("y2 " + c.alg).moves);
  const start = applyMoves(SOLVED, invert(mv));
  const nw = newly(start, applyMoves(start, mv));
  const r = judgePair({ start, moves: mv, slot: nw[0], startGrip: START_GRIP });
  check(r.verdict === "ok" && r.n === c.n && heldSlot(nw[0], START_GRIP) === "BL", `y2 + ${c.n}: ${JSON.stringify(r)} ${nw}`);
}

// 5) Løst i BL uten rotasjon der BL ikke er avtalt → ikke-avtalt (ingen alarm).
{
  const mv = expand("y2 " + CASE_BY_N[9].alg).moves.map((m) => ({ ...m, grip: START_GRIP, grips: [START_GRIP] }));
  const start = applyMoves(SOLVED, invert(mv));
  const nw = newly(start, applyMoves(start, mv));
  const r = judgePair({ start, moves: mv, slot: nw[0], startGrip: START_GRIP });
  check(r.verdict === "ikke-avtalt" && r.n === 9 && r.held === "BL", `9 i BL uten rotasjon: ${JSON.stringify(r)}`);
}

// 6) Brikke i feil spor: ta den ut (R' U R i BR), så avtalt løsning → ok (uttaket teller ikke med).
//    Og samme uttak når paret allerede er en case → feil (uttaket kommer med i rettingen).
let tested6 = 0;
for (const c of CASES.filter((x) => x.n <= 36)) for (let d = 0; d < 4; d++) {
  const ext = withG(expand("R' U R").moves);
  const caseState = turn(applyMoves(SOLVED, invert(expand(c.alg).moves)), "D", d);
  const start = applyMoves(caseState, invert(ext));
  if (caseOf(start, "FL") != null || !crossSolved(start)) continue; // vil ha en start der paret ikke er en case
  const alg = withG(expand(c.alg).moves);
  const auf = d ? [{ face: "D", amt: (4 - d) % 4, grip: START_GRIP, grips: [START_GRIP] }] : [];
  const all = [...ext, ...auf, ...alg];
  const nw = newly(start, applyMoves(start, all));
  if (!nw.includes("FL")) continue; // (i testen blir BR løst igjen av uttaket; i en ekte løsning står det en annen brikke der)
  tested6++;
  const r = judgePair({ start, moves: all, slot: "FL", startGrip: START_GRIP });
  check(r.verdict === "ok" && r.n === c.n, `uttak + ${c.n}/${d}: ${JSON.stringify(r)}`);
}
check(tested6 > 10, `uttak testet ${tested6}`);

// 6b) Multislotting: R U R' i BR (rører ikke FL-paret) før avtalt løsning → ok. 9 med gammel løsning → fortsatt feil.
{
  let tested = 0;
  for (const c of CASES.filter((x) => x.n <= 36)) {
    const caseState = applyMoves(SOLVED, invert(expand(c.alg).moves));
    const other = withG(expand("y2 R U R'").moves.map((m) => ({ ...m, grip: START_GRIP })));
    const mid = applyMoves(caseState, other);
    if (caseOf(mid, "FL") !== c.n || !crossSolved(mid)) continue;
    tested++;
    const all = [...other, ...withG(expand(c.alg).moves)];
    const nw = newly(caseState, applyMoves(caseState, all));
    const r = judgePair({ start: caseState, moves: all, slot: "FL", startGrip: START_GRIP });
    check(r.verdict === "ok" && r.n === c.n, `multislot + ${c.n}: ${JSON.stringify(r)} ${nw}`);
  }
  check(tested >= 3, `multislot testet ${tested}`);
  // Ledig spor brukt til å endre casen (bare B/R/U i sensorramme – rører ikke FL-sidene), så avtalt løsning
  // for casen det ble → ok.
  let changed = 0;
  for (const c of CASES.filter((x) => x.n <= 36)) for (const preS of ["R D R'", "R D' R'", "B D B'", "B' D' B"]) {
    const caseState = applyMoves(SOLVED, invert(expand(c.alg).moves));
    const pre = preS.split(" ").map((t) => ({ face: t[0], amt: t[1] === "'" ? 3 : 1, grip: START_GRIP, grips: [START_GRIP] }));
    const mid = applyMoves(caseState, pre);
    const n2 = crossSolved(mid) ? caseOf(mid, "FL") : null;
    if (n2 == null || n2 === c.n || n2 > 36) continue;
    const alg2 = expand(CASE_BY_N[n2].alg).moves;
    const auf = [0, 1, 2, 3].find((k) => solvedSlots(applyMoves(turn(mid, "D", k), alg2)).has("FL"));
    if (auf == null) continue;
    const all = [...pre, ...(auf ? [{ face: "D", amt: auf, grip: START_GRIP, grips: [START_GRIP] }] : []), ...withG(alg2)];
    changed++;
    const r = judgePair({ start: caseState, moves: all, slot: "FL", startGrip: START_GRIP });
    check(r.verdict === "ok" && r.n === n2 && r.multislot === c.n, `ledig spor ${c.n}→${n2} (${preS}): ${JSON.stringify(r)}`);
  }
  check(changed >= 10, `ledig spor testet ${changed}`);
  const st9 = applyMoves(SOLVED, invert(expand(CASE_BY_N[9].alg).moves));
  let ran9 = 0;
  for (const pre of ["", "U ", "U2 ", "U' "]) {
    const mv = withG(expand(pre + "R U' R' U y' R' U' R").moves);
    const end = applyMoves(st9, mv);
    if (!solvedSlots(end).has("FL")) continue;
    const r = judgePair({ start: st9, moves: mv, slot: "FL", startGrip: START_GRIP });
    ran9++;
    check(r.verdict === "feil" && r.n === 9, `9 gammel løsning: ${JSON.stringify(r)}`);
  }
  check(ran9 > 0, "9 gammel løsning testet");
}

// 6c) Grep fra før casen startet (eller en rotasjon midt i løsningen) bestemmer ikke sporet:
//     17 startet i FL (ingen avtalt løsning der) med y midt i → ikke-avtalt i FL, ikke feil i BL.
{
  const yG = rotateGrip(START_GRIP, "y", 1);
  const c17 = CASE_BY_N[17];
  // en løsning som starter i startgrepet, roterer y og setter inn (trekkene trenger ikke være avtalt)
  const mv = expand("R U2 R' y L U L'", START_GRIP).moves.map((m) => ({ ...m, grips: [m.grip] }));
  const st = applyMoves(SOLVED, invert(mv));
  const nw = newly(st, applyMoves(st, mv));
  const pre = [{ face: "D", amt: 0, grip: yG, grips: [yG] }].filter((m) => m.amt);
  const r = judgePair({ start: st, moves: mv, slot: nw[0], startGrip: yG }); // segmentet startet i y-grep
  check(r.verdict !== "feil" || r.held === heldSlot(nw[0], START_GRIP), `grep ved start avgjør sporet: ${JSON.stringify(r)}`);
}

// 6d) FR-løsningen flyttet til andre spor (uten egen sporløsning) → ok uten alarm-plikt; annen løsning der → ikke-avtalt.
{
  const { slotCopies } = await import("../src/slowsolve.js");
  let cnt = 0;
  for (const c of CASES) for (const held of ["FL", "BL", "BR"]) {
    if (variant(c.n, held)) continue; // egen sporløsning finnes – testes andre steder
    const a = slotCopies(c.n, held)[0];
    if (!a) continue; // FR-løsningen har rotasjon – ingen kopi
    const mv = withG(expand(a, START_GRIP).moves);
    const st = applyMoves(SOLVED, invert(mv));
    const nw = newly(st, applyMoves(st, mv));
    const r = judgePair({ start: st, moves: mv, slot: nw[0], startGrip: START_GRIP });
    cnt++;
    check(r.verdict === "ok" && r.n === c.n && r.held === held && r.copy, `kopi ${c.n} ${held} ${a}: ${JSON.stringify(r)}`);
  }
  check(cnt > 40, `kopier testet ${cnt}`);
  // 1 i BL med L U' L' (etter AUF) er riktig
  const one = withG(expand("U L U' L'", START_GRIP).moves);
  const st1 = applyMoves(SOLVED, invert(one));
  const r1 = judgePair({ start: st1, moves: one, slot: newly(st1, applyMoves(st1, one))[0], startGrip: START_GRIP });
  check(r1.verdict === "ok" && r1.n === 1 && r1.held === "BL", `1 i BL: ${JSON.stringify(r1)}`);
}

// 7) Kryss og scramble.
check(crossSolved(SOLVED) && !crossSolved(turn(SOLVED, "F", 1)) && crossSolved(turn(SOLVED, "D", 1)), "kryss");
// Scramblene: krysset står alltid; målscramblen gir riktig case i riktig spor, også fra F2L-løst med uløst siste lag.
const llMixed = applyMoves(SOLVED, expand("R U R' U R U2 R' F R U R' U' F'").moves);
for (let i = 0; i < 300; i++) {
  const g = makeCrossScramble();
  check(crossSolved(applyMoves(llMixed, g)), "kryss-scramble bryter krysset");
  const c = CASES[i % 41], sl = SENSOR_SLOTS[i % 4];
  const from = i % 2 ? SOLVED : llMixed;
  check(f2lSolved(from), "start");
  const t = makeTargetScramble(c.n, sl);
  const st = applyMoves(from, t);
  check(crossSolved(st) && caseOf(st, sl) === c.n, `målscramble ${c.n} ${sl}: case ${caseOf(st, sl)}`);
  check(t.length < 45, `lengde ${t.length}`);
}
console.log(bad ? `${bad} av ${n} feil` : `slowsolve: ${n} kontroller ok`);
process.exit(bad ? 1 : 0);
