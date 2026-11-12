// De 41 basic-F2L-casene i acubemy-nummerering (samme som solved.no), FR-spor.
// book = Cubing Bible, Basic F2L s. 103–106 (bok-nummer og FR-algoritme).
// locked = Vegards låste løsning der den avviker fra boka (Notion / analyse/f2l.py LOCKED).
// alts = andre skrivemåter som godtas som samme valg (bokas kontrollerte alternativer).

const BOOK = {
  1: "U R U' R'", 2: "F R' F' R", 3: "y' R' U' R", 4: "R U R'",
  5: "U' R U R' U2 R U' R'", 6: "y' U R' U' R U R' U2 R", 7: "U' R U2 R' U2 R U' R'",
  8: "y' U R' U2 R U R' U2 R", 9: "y' U2 R' U R U R' U' R", 10: "U2 R U' R' U' R U R'",
  11: "y' R U2 R2 U' R2 U' R'", 12: "U R U' R' U' R U R' U' R U R'",
  13: "y' U R' U R U' R' U' R", 14: "U' R U' R' U R U R'", 15: "R' D' R U' R' D R U R U' R'",
  16: "R U' R' U2 y' R' U' R", 17: "R U2 R' U' R U R'", 18: "y' R' U2 R U R' U' R",
  19: "R U2 R' U R U' R'", 20: "y' R' U2 R U' R' U R", 21: "R U R' U R U' R'",
  22: "y' R' U' R U' R' U R", 23: "U R U' R' U' R U' R' U R U' R'", 24: "F U R U' R' F' R U' R'",
  25: "U' R' F R F' R U R'", 26: "U R U' R' F R' F' R", 27: "R U' R' U R U' R'",
  28: "y' R' U R U' R' U R", 29: "y' R' U' R U R' U' R", 30: "R U R' U' R U R'",
  31: "U' R' F R F' R U' R'", 32: "U R U' R' U R U' R' U R U' R'", 33: "U' R U' R' U2 R U' R'",
  34: "U R' D' R U' R' D R", 35: "U2 R U R' F R' F' R", 36: "U2 R' F R F' U2 R U R'",
  37: "R' F R F' R U' R' U R U' R' U2 R U' R'", 38: "R U' R' U' R U R' U2 R U' R'",
  39: "R U' R' U R U2 R' U R U' R'", 40: "R U' R' U' R U' R' U y' R' U' R",
  41: "F R' F' R2 U' R' U2 y' R' U' R",
};
const ACU2BOOK = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7, 7: 6, 8: 8, 9: 13, 10: 14, 11: 32, 12: 31, 13: 19, 14: 18, 15: 33, 16: 34, 17: 23, 18: 24, 19: 9, 20: 11, 21: 10, 22: 12, 23: 38, 24: 39, 25: 30, 26: 29, 27: 15, 28: 17, 29: 20, 30: 16, 31: 26, 32: 25, 33: 21, 34: 22, 35: 27, 36: 28, 37: 35, 38: 37, 39: 36, 40: 40, 41: 41 };
// 12.11.: 24, 35 og 36 tatt ut – Vegard roterer bare der boka roterer, og bokas FR-algoritmer for disse er rotasjonsfrie.
const LOCKED = {
  6: "y' U R' U' R U2 R' U R", 8: "y' U R' U2 R U2 R' U R",
};
// 28 og 34: FR-kolonnen i «Basic F2L from 4 angles» (s. 178 og 179), som Vegard bruker i solvene (analyse 12.11.).
const ALTS = { 21: ["U2 R U' R' U2 R U R'"], 22: ["U2 r U' r' U2 r U r'", "U2 F' L' U2 L F"], 28: ["R U R' U' F R' F' R"], 34: ["U R U R' U2 R U R'"] };

export const CASES = Object.keys(BOOK).map(Number).map((n) => ({
  n,
  bookNo: ACU2BOOK[n],
  bookPage: ACU2BOOK[n] <= 8 ? 103 : ACU2BOOK[n] <= 21 ? 104 : ACU2BOOK[n] <= 34 ? 105 : 106,
  book: BOOK[n],
  alg: LOCKED[n] || BOOK[n],
  source: LOCKED[n] ? "låst" : "bok",
  alts: LOCKED[n] ? [] : ALTS[n] || [],
}));

// Avtalte løsninger i de andre sporene (Notion «F2L-prioritering»: kjente/speilede fra bok s. 176–179,
// 24 FL = Vegards L-versjon, 19 BR lært 2.11.). Alle kontrollert i analyse-simulatoren 12.11.:
// løser riktig case i riktig spor og bare det sporet. Caser som mangler her er ikke avtalt ennå (grå i pluginen).
export const SLOTS = ["FR", "FL", "BL", "BR"];
export const SLOT_ALGS = {
  FL: { 8: "U L' U2 L U2 L' U L", 18: "L' U2 L U L' U' L", 20: "L' U2 L U' L' U L", 22: "L' U' L U' L' U L", 24: "U' L' U L U L' U L U' L' U L", 31: "U L F' L' F L' U L", 32: "L' U' L U L' U' L U L' U' L", 36: "U2 L' U' L F' L F L'" },
  BL: { 7: "U' L U2 L' U2 L U' L'", 17: "L U2 L' U' L U L'", 19: "L U2 L' U L U' L'", 21: "L U L' U L U' L'", 32: "L U L' U' L U L' U' L U L'" },
  BR: { 8: "U R' U2 R U2 R' U R", 18: "R' U2 R U R' U' R", 19: "R' F' U2 F R U R' U' R", 20: "R' U2 R U' R' U R", 22: "U2 R' U' R U' R' U R", 32: "R' U' R U R' U' R U R' U' R" },
};

// Låst fra solvene (analyse 12.11., eksport 26.10.–12.11., 465 solves, 1242 klassifiserte par, sporet slik
// Vegard holdt kuben ved første trekk): løsningen han bruker i minst 60 % av minst 4 forsøk i sporet og som
// står i boka for det sporet (s. 176–179, lest og kontrollert i simulator), eller den avtalte FR-løsningen.
// Nye sporløsninger herfra legges til i SLOT_ALGS; alle i SOLVE_LOCKED gir alarm i slow solve.
Object.assign(SLOT_ALGS.BL, {"1": "U L U' L'", "4": "L U L'", "5": "U' L U L' U2 L U' L'", "14": "U' L U' L' U L U L'", "23": "U L U' L' U' L U' L' U L U' L'", "25": "L U' L' U' L U' L' U L U L'", "27": "L U' L' U L U' L'", "33": "U' L U' L' U2 L U' L'"});
Object.assign(SLOT_ALGS.FL, {"2": "U' L' U L", "3": "L' U' L", "4": "F U F'", "6": "U L' U' L U2 L' U L", "13": "U L' U L U' L' U' L", "33": "U' L' U' L U2 L' U' L", "34": "U L' U L U2 L' U L"});
Object.assign(SLOT_ALGS.BR, {"2": "U' R' U R", "3": "R' U' R", "6": "U R' U' R U2 R' U R", "13": "U R' U R U' R' U' R"});
// Unntak (Vegard 12.11. 21:15): der boka bruker brede trekk (1 FL F' r U r', 3 BL f' L' f, 4 BR f R f', 12 BR
// … f R f', 15 BR … f R f'), gjør Vegard samme resultat med vanlige flatetrekk (B' U' B osv., sett i eksporten).
// Det er ikke bokas utførelse. Tatt ut igjen (Vegard 21:32): å låse hans egen variant ville øve inn en mulig uvane.
// De er frie (ingen alarm) til bokas versjon (antakelig valgt for fingertricks) er testet etter Asker.
// (21:29 ble de låst med fri rotasjon, OWN_LOOSE; erstattet 21:32 av at de er frie. Mekanismen står igjen, tom.)
export const OWN_LOOSE = { FL: [], BL: [], BR: [] };
export const SOLVE_LOCKED = {"FR": [1, 2, 3, 4, 5, 7, 14, 16, 17, 19, 20, 21, 22, 23, 27, 28, 34, 38], "FL": [2, 3, 4, 6, 8, 13, 18, 20, 22, 24, 33, 34], "BL": [1, 4, 5, 7, 14, 17, 19, 21, 23, 25, 27, 33], "BR": [2, 3, 6, 13, 18, 20, 22]};
export const isSolveLocked = (n, slot) => !!(SOLVE_LOCKED[slot] && SOLVE_LOCKED[slot].includes(n));

/** Casen i et gitt spor: samme felt som i CASES, med sporets algoritme. null = ikke avtalt ennå. */
export function variant(n, slot) {
  const c = CASES.find((x) => x.n === n);
  if (slot === "FR") return { ...c, slot, key: String(n) };
  const alg = SLOT_ALGS[slot] && SLOT_ALGS[slot][n];
  const loose = !!(OWN_LOOSE[slot] && OWN_LOOSE[slot].includes(n));
  return alg ? { ...c, alg, alts: [], source: loose ? "egen" : "spor", loose, slot, key: `${n}@${slot}` } : null;
}

export const CASE_BY_N = Object.fromEntries(CASES.map((c) => [c.n, c]));

// Innført med avtalt løsning (Notion «F2L-prioritering»: blokk 1–4, bokbytte 31.10. for 10 og 14, 12 til bok 12.11.,
// og caser der bokas løsning allerede brukes nesten alltid: 3, 4, 19, 20, 21, 22, 23). Slow solve gir alarm for disse.
// Ikke med (egen løsning er lov til det er bestemt): 1, 2, 5, 11, 13, 15, 25–30, 34, 37–41.
export const INTRODUCED = [3, 4, 6, 7, 8, 9, 10, 12, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 31, 32, 33, 35, 36];

// Konsolideringen før Asker (Notion 9.11.): 7, 8, 9, 16, 33.
export const DEFAULT_SELECTION = [7, 8, 9, 16, 33];

// Siste-lag-algoritmer brukt bare til å blande toppen i oppsettet (påvirker ikke F2L).
export const LL_SCRAMBLERS = [
  "R U R' U R U2 R'", "R U2 R' U' R U' R'", "R U R' U' R' F R2 U' R' U' R U R' F'",
  "R U R' F' R U R' U' R' F R2 U' R'", "R U' R U R U R U' R' U' R2", "F R U R' U' F'",
];
