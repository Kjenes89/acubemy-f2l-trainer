// Ren løsningslogikk (ingen DOM): sporing av forventet trekkrekke, AUF, og sammenligning av
// utført løsning mot valgt algoritme – inkludert grepet (rotasjonene) hvert trekk ble tatt i.
import { OPPOSITE } from "./cube.js";
import { canonical, sameGrip, yNeeded, START_GRIP } from "./alg.js";

// ---------- sporing av forventet trekkrekke ----------
export class Tracker {
  constructor(items) { this.items = items.map((m) => ({ ...m })); }
  get correcting() { return this.items.length > 0 && this.items[0].corr; }
  step(face, a, grip = null) {
    const it = this.items;
    let i = 0;
    const wrongGrip = (m) => grip && m && !m.corr && !m.auf && m.grip && !sameGrip(grip, m.grip);
    if (it[0] && it[0].face !== face && it[1] && OPPOSITE[it[0].face] === it[1].face && it[1].face === face && !it[0].corr) i = 1;
    if (it[i] && it[i].face === face && !wrongGrip(it[i])) {
      it[i].amt = (it[i].amt - a + 4) % 4;
      if (!it[i].amt) it.splice(i, 1);
      return true;
    }
    it.unshift({ face, amt: (4 - a) % 4, corr: true });
    return false;
  }
}

// Casens AUF = tilfeldig AUF slått sammen med U-trekkene algoritmen starter med (bokas «U2» o.l.).
export function withPreAuf(aufAmt, algMoves) {
  const moves = algMoves.map((m) => ({ ...m }));
  let amt = aufAmt;
  const hidden = new Set();
  while (moves.length && moves[0].face === "D") { amt += moves[0].amt; hidden.add(moves[0].tok); moves.shift(); }
  amt %= 4;
  return { items: amt ? [{ face: "D", amt, tok: -1, auf: true }, ...moves] : moves, hidden, aufAmt: amt };
}

// Trekk med grep: like flater på rad i samme grep slås sammen, U-trekk først og sist (AUF) tas bort.
export function withGrips(moves) {
  const out = [];
  for (const m of moves) {
    const grips = m.grips || (m.grip ? [m.grip] : []);
    const last = out[out.length - 1];
    if (last && last.face === m.face && (!grips.length || last.grips.some((g) => grips.some((h) => sameGrip(g, h))))) {
      last.amt = (last.amt + m.amt) % 4;
      if (!last.amt) out.pop();
    } else if (m.amt % 4) out.push({ face: m.face, amt: m.amt % 4, grips });
  }
  while (out.length && out[0].face === "D") out.shift();
  while (out.length && out[out.length - 1].face === "D") out.pop();
  return out;
}

// Samme løsning som algoritmen? Samme trekk, og – når gyroen gir grep – hvert trekk tatt i samme grep
// som algoritmen forutsetter. F' U' F godtas altså ikke for y' R' U' R.
export function sameSolution(executed, algMoves, { strictGrip = true } = {}) {
  if (canonical(executed) !== canonical(algMoves)) return false;
  if (!strictGrip) return true; // algoritmer med brede trekk/slices: grepet kan ikke leses sikkert nok
  const a = withGrips(executed), b = withGrips(algMoves);
  // U- og D-trekk er de samme før og etter en y-rotasjon (de ligger på rotasjonsaksen): der holder det at
  // opp/ned stemmer, ellers ville U' rett før y bli avvist hvis gyroen leser rotasjonen litt tidlig.
  const okGrip = (m, e) => (m.face === e.U || m.face === e.D ? (g) => g.U === e.U : (g) => sameGrip(g, e));
  return a.length === b.length && a.every((m, i) => m.face === b[i].face && m.amt === b[i].amt && (!b[i].grips[0] || m.grips.some(okGrip(m, b[i].grips[0]))));
}

// Det du gjorde, skrevet slik du holdt kuben (grep fra gyroen ved hvert trekk), med rotasjonene du tok.
export function didInYourGrip(executed, start = START_GRIP) {
  const out = [];
  let grip = start;
  for (const m of executed) {
    if (m.grip && !sameGrip(m.grip, grip)) {
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

