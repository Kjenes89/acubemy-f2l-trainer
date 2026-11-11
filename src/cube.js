// Kubemodell på Kociemba-fasetter (54 tegn, URFDLB, radvis), samme format som acubemy-SDK-en.
// «Sensorramme» = kubens egen ramme: U = hvit, F = grønn, R = rød (som SDK-en).

export const FACES = "URFDLB";
export const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
export const OPPOSITE = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };

function coord(face, r, c) {
  switch (face) {
    case "U": return [-1 + c, 1, -1 + r];
    case "R": return [1, 1 - r, 1 - c];
    case "F": return [-1 + c, 1 - r, 1];
    case "D": return [-1 + c, -1, 1 - r];
    case "L": return [-1, 1 - r, -1 + c];
    case "B": return [1 - c, 1 - r, -1];
  }
}

/** Posisjon og normal for hvert av de 54 klistremerkene i kubens egen ramme (x = R, y = U, z = F). */
export const STICKERS = [];
for (let i = 0; i < 54; i++) {
  const face = FACES[(i / 9) | 0];
  const k = i % 9;
  STICKERS.push({ pos: coord(face, (k / 3) | 0, k % 3), n: NORMAL[face] });
}
const key = (p, n) => p.join(",") + "|" + n.join(",");
const INDEX = new Map(STICKERS.map((s, i) => [key(s.pos, s.n), i]));

// Rotasjon 90° om en akse; cw = med klokka sett fra den positive enden av aksen.
function rot(v, axis, cw) {
  const [x, y, z] = v;
  if (axis === 0) return cw ? [x, z, -y] : [x, -z, y];
  if (axis === 1) return cw ? [-z, y, x] : [z, y, -x];
  return cw ? [y, -x, z] : [-y, x, z];
}

const AXIS = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };
const PERM = {};
for (const f of FACES) {
  const a = AXIS[f];
  const sign = NORMAL[f][a];
  const perm = Array.from({ length: 54 }, (_, i) => i); // perm[dst] = src
  STICKERS.forEach((s, src) => {
    if (s.pos[a] !== sign) return;
    // Med klokka sett fra flaten selv: positive flater roterer cw om +akse, negative ccw.
    const cw = sign > 0;
    const dst = INDEX.get(key(rot(s.pos, a, cw), rot(s.n, a, cw)));
    perm[dst] = src;
  });
  PERM[f] = perm;
}

/** Kvartdreiing(er) av én flate i sensorrammen. amt: 1 = med klokka, 2 = halv, 3 = mot klokka. */
export function turn(state, face, amt = 1) {
  let s = state;
  for (let k = 0; k < ((amt % 4) + 4) % 4; k++) {
    const p = PERM[face];
    let out = "";
    for (let i = 0; i < 54; i++) out += s[p[i]];
    s = out;
  }
  return s;
}

/** Bruk en liste {face, amt} i sensorrammen. */
export function applyMoves(state, moves) {
  return moves.reduce((s, m) => turn(s, m.face, m.amt), state);
}

/** Første to lag løst? Krysset er på hvit = sensor U. */
export function f2lSolved(s) {
  for (let i = 0; i < 9; i++) if (s[i] !== "U") return false;
  for (const f of "RFLB") {
    const o = FACES.indexOf(f) * 9;
    for (let i = 0; i < 6; i++) if (s[o + i] !== f) return false;
  }
  return true;
}

/** Hvor mange av de fire F2L-sporene som er løst (kryss må være på plass). */
export function crossSolved(s) {
  for (const i of [1, 3, 4, 5, 7]) if (s[i] !== "U") return false;
  for (const f of "RFLB") if (s[FACES.indexOf(f) * 9 + 1] !== f) return false;
  return true;
}

/**
 * Flatene slik Vegard holder kuben (hvit ned, grønn foran = z2 fra sensorrammen).
 * z2 er en halv rotasjon om F–B-aksen: U↔D, R↔L, og alle flater snus 180°.
 */
export function heldFaces(s) {
  const face = (f) => s.slice(FACES.indexOf(f) * 9, FACES.indexOf(f) * 9 + 9).split("").reverse();
  return { U: face("D"), D: face("U"), R: face("L"), L: face("R"), F: face("F"), B: face("B") };
}

export const COLORS = { U: "#f4f4f4", R: "#e0303c", F: "#2fb34a", D: "#f2d21b", L: "#ff8a1c", B: "#2a64d8" };
