// Isometrisk tegning av kuben slik Vegard holder den: gul topp, grønn front, oransje høyre.
import { heldFaces, COLORS } from "./cube.js";

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const proj = ([x, y, z]) => [(x - z) * C30, -y + (x + z) * S30];

function quad(center, a, b, color) {
  const d = 0.46;
  const pts = [[-d, -d], [d, -d], [d, d], [-d, d]].map(([i, j]) =>
    proj([0, 1, 2].map((k) => center[k] + a[k] * i + b[k] * j)));
  return `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(3)).join(",")).join(" ")}" fill="${color}" stroke="#111" stroke-width="0.06" stroke-linejoin="round"/>`;
}

// Posisjon i grepet (x høyre, y opp, z mot deg) for klistremerke (r, c) på hver grep-flate.
const HELD_POS = {
  U: (r, c) => [-1 + c, 1, -1 + r],
  D: (r, c) => [-1 + c, -1, 1 - r],
  F: (r, c) => [-1 + c, 1 - r, 1],
  B: (r, c) => [1 - c, 1 - r, -1],
  R: (r, c) => [1, 1 - r, 1 - c],
  L: (r, c) => [-1, 1 - r, -1 + c],
};

/** Alle brikker med gult (siste-lag-brikker, også en som står i sporet) grås ut, slik at bare F2L-brikkene synes. */
function lastLayerMask(h) {
  const pieces = new Map();
  for (const f of "UDFRBL") for (let i = 0; i < 9; i++) {
    const p = HELD_POS[f]((i / 3) | 0, i % 3);
    const k = p.join(",");
    if (!pieces.has(k)) pieces.set(k, []);
    pieces.get(k).push([f, i]);
  }
  const grey = new Set();
  for (const stickers of pieces.values()) {
    if (stickers.some(([f, i]) => h[f][i] === "D")) for (const [f, i] of stickers) grey.add(f + i);
  }
  return grey;
}

const GREY = "#3a3d42";

export function cubeSvg(facelets, { dimLastLayer = true } = {}) {
  const h = heldFaces(facelets);
  const grey = dimLastLayer ? lastLayerMask(h) : new Set();
  const color = (f, i) => (grey.has(f + i) ? GREY : COLORS[h[f][i]]);
  let out = "";
  for (let i = 0; i < 9; i++) out += quad(HELD_POS.U((i / 3) | 0, i % 3).map((v, k) => (k === 1 ? 1.5 : v)), [1, 0, 0], [0, 0, 1], color("U", i));
  for (let i = 0; i < 9; i++) out += quad(HELD_POS.F((i / 3) | 0, i % 3).map((v, k) => (k === 2 ? 1.5 : v)), [1, 0, 0], [0, -1, 0], color("F", i));
  for (let i = 0; i < 9; i++) out += quad(HELD_POS.R((i / 3) | 0, i % 3).map((v, k) => (k === 0 ? 1.5 : v)), [0, 0, -1], [0, -1, 0], color("R", i));
  return `<svg viewBox="-3.1 -3.3 6.2 6.6" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}
