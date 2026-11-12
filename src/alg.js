// Algoritmer i Vegards grep (hvit ned, grønn foran) → flatetrekk i kubens sensorramme.
// Rotasjoner (x y z), brede trekk (r l u d f b, Rw …) og slices (M E S) gir ingen egne
// sensortrekk for rotasjonsdelen; de endrer bare hvilken fysisk flate «R» osv. er etterpå.
import { OPPOSITE } from "./cube.js";

// Grep → sensor ved start: z2 (U↔D, R↔L).
const START = { U: "D", D: "U", R: "L", L: "R", F: "F", B: "B" };
export const SENSOR_TO_HELD = { U: "D", D: "U", R: "L", L: "R", F: "F", B: "B" };

function rotate(map, axis, times) {
  // Nytt grep etter rotasjon: hvilken gammel grep-flate havner der.
  const cycles = {
    y: { F: "R", R: "B", B: "L", L: "F" },
    x: { U: "F", F: "D", D: "B", B: "U" },
    z: { R: "U", U: "L", L: "D", D: "R" },
  }[axis];
  let m = map;
  for (let k = 0; k < ((times % 4) + 4) % 4; k++) {
    const n = { ...m };
    for (const [to, from] of Object.entries(cycles)) n[to] = m[from];
    m = n;
  }
  return m;
}

// Brede trekk og slices: [flate, retning-faktor] + rotasjon [akse, faktor].
const WIDE = {
  r: [["L", 1]], l: [["R", 1]], u: [["D", 1]], d: [["U", 1]], f: [["B", 1]], b: [["F", 1]],
  M: [["R", 1], ["L", -1]], E: [["U", 1], ["D", -1]], S: [["F", -1], ["B", 1]],
};
const WIDE_ROT = { r: ["x", 1], l: ["x", -1], u: ["y", 1], d: ["y", -1], f: ["z", 1], b: ["z", -1], M: ["x", -1], E: ["y", -1], S: ["z", 1] };

export function tokenize(alg) {
  return alg.replace(/[()\[\]]/g, " ").trim().split(/\s+/).filter(Boolean);
}

function parseToken(tok) {
  const m = /^([URFDLBMESxyzurfdlb])(w?)(2'|'2|2|'|3)?$/.exec(tok);
  if (!m) throw new Error("Ukjent trekk: " + tok);
  let base = m[1];
  if (m[2]) base = base.toLowerCase();
  const suf = m[3] || "";
  const amt = suf.includes("2") ? 2 : suf === "'" || suf === "3" ? 3 : 1; // R3 = tre kvarttrekk (fingertriks), samme som R'
  return { base, amt };
}

/**
 * Utvid en algoritme til sensortrekk. Hvert trekk får `tok` = indeks i token-lista.
 * `start` = grepet algoritmen starter i (standard: hvit ned, grønn foran).
 * Returnerer { tokens, moves }.
 */
export function expand(alg, start = START) {
  const tokens = tokenize(alg);
  let map = { ...start };
  const moves = [];
  tokens.forEach((tok, ti) => {
    const { base, amt } = parseToken(tok);
    if ("xyz".includes(base)) {
      map = rotate(map, base, amt);
    } else if (WIDE[base]) {
      for (const [f, k] of WIDE[base]) moves.push({ face: map[f], amt: (((amt * k) % 4) + 4) % 4, tok: ti, grip: { ...map } });
      const [ax, k] = WIDE_ROT[base];
      map = rotate(map, ax, amt * k);
    } else {
      moves.push({ face: map[base], amt, tok: ti, grip: { ...map } });
    }
  });
  return { tokens, moves };
}

export function invert(moves) {
  return moves.slice().reverse().map((m) => ({ face: m.face, amt: (4 - m.amt) % 4 }));
}

/** Slå sammen like flater (også over en motstående flate) og fjern nulltrekk. */
export function simplify(moves) {
  const out = [];
  for (const m0 of moves) {
    const m = { face: m0.face, amt: ((m0.amt % 4) + 4) % 4 };
    if (!m.amt) continue;
    const top = out[out.length - 1];
    const second = out[out.length - 2];
    if (top && top.face === m.face) {
      top.amt = (top.amt + m.amt) % 4;
      if (!top.amt) out.pop();
    } else if (top && second && OPPOSITE[top.face] === m.face && second.face === m.face) {
      second.amt = (second.amt + m.amt) % 4;
      if (!second.amt) out.splice(out.length - 2, 1);
    } else {
      out.push(m);
    }
  }
  // Fast rekkefølge på motstående par, så R L' og L' R blir like.
  const order = "URFDLB";
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    if (OPPOSITE[a.face] === b.face && order.indexOf(a.face) > order.indexOf(b.face)) {
      out[i] = b; out[i + 1] = a;
    }
  }
  return out;
}

/** Fjern AUF (siste lag = sensor D) først og sist. */
export function stripAuf(moves) {
  let s = moves.slice();
  while (s.length && s[0].face === "D") s.shift();
  while (s.length && s[s.length - 1].face === "D") s.pop();
  return s;
}

// Trekk på motstående flater (U og D, R og L, F og B) kan byttes om uten at resultatet endres
// (f.eks. «U' D» = «D U'» i Ga). Fast rekkefølge, så slike par sammenlignes likt.
const FACE_ORDER = "URFDLB";
export function orderOpposites(moves) {
  const out = moves.slice();
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      if (OPP[a.face] === b.face && FACE_ORDER.indexOf(a.face) > FACE_ORDER.indexOf(b.face)) { out[i] = b; out[i + 1] = a; changed = true; }
    }
  }
  return out;
}
const OPP = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

export function canonical(moves) {
  return orderOpposites(stripAuf(simplify(moves))).map((m) => m.face + m.amt).join(" ");
}

/** Sensortrekk → notasjon i grepet (for visning av oppsett og retting). */
export function heldNotation(m) {
  const f = SENSOR_TO_HELD[m.face];
  const a = ((m.amt % 4) + 4) % 4;
  return f + (a === 2 ? "2" : a === 3 ? "'" : "");
}

/** Grepet slik algoritmen starter: hvit ned, grønn foran. Nøkkel = flate i grepet, verdi = sensorflate. */
export const START_GRIP = { ...START };

/** Notasjon for et sensortrekk i et gitt grep (f.eks. fra gyroen). */
export function gripNotation(m, grip) {
  const f = Object.keys(grip).find((k) => grip[k] === m.face) || "?";
  const a = ((m.amt % 4) + 4) % 4;
  return f + (a === 2 ? "2" : a === 3 ? "'" : "");
}

/** Samme grep? (U og F avgjør hele orienteringen.) */
export function sameGrip(a, b) {
  return a && b && a.U === b.U && a.F === b.F;
}

/** Grepet etter en rotasjon (for å finne hvilken rotasjon som trengs). */
export function rotateGrip(grip, axis, times) { return rotate(grip, axis, times); }

/** Hvilken y-rotasjon tar grepet `from` til `to`? «y», «y2», «y'», "" (allerede likt) eller null (ikke bare y). */
export function yNeeded(from, to) {
  if (sameGrip(from, to)) return "";
  for (const [t, name] of [[1, "y"], [2, "y2"], [3, "y'"]]) if (sameGrip(rotate(from, "y", t), to)) return name;
  return null;
}
