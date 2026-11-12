// Vegards 21 PLL-algoritmer (Notion «Komplett personlig PLL-algoritmeliste», samme som cases.json i
// pll-recognition-trainer). exec = utførelsen fra hans startvinkel (hvit ned, grønn foran); pre = orienteringen
// relativt til acubemys casebilde (brukes ikke her: casen lages på den virtuelle kuben i hans startvinkel).
// x, x' og y inne i exec er ekte rotasjoner. R3 = tre kvarttrekk (fingertriks), R2' = R2.
export const PLLS = [
  { name: "Aa", pre: "y", exec: "x' R2 D2 R' U' R D2 R' U R' x" },
  { name: "Ab", pre: "y", exec: "x' R U' R D2 R' U R D2 R2 x" },
  { name: "E", pre: "y", exec: "x' R U' R' D R U R' D' R U R' D R U' R' D' x" },
  { name: "F", pre: "y", exec: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R" },
  { name: "Ga", pre: "", exec: "R2 U R' U R' U' R U' R2 D U' R' U R D'" },
  { name: "Gb", pre: "y", exec: "F' U' F R2 u R' U R U' R u' R2" },
  { name: "Gc", pre: "y2", exec: "R2 F2 R U2 R U2 R' F R U R' U' R' F R2" },
  { name: "Gd", pre: "", exec: "R U R' U' D R2 U' R U' R' U R' U R2 D'" },
  { name: "H", pre: "", exec: "M2 U' M2 U2 M2 U' M2" },
  { name: "Ja", pre: "y", exec: "R' U L' U2 R U' R' U2 R L" },
  { name: "Jb", pre: "", exec: "R U R' F' R U R' U' R' F R2 U' R'" },
  { name: "Na", pre: "", exec: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'" },
  { name: "Nb", pre: "", exec: "R' U R U' R' F' U' F R U R' F R' F' R U' R" },
  { name: "Ra", pre: "y", exec: "R U' R' U' R U R D R' U' R D' R' U2 R'" },
  { name: "Rb", pre: "", exec: "R' U2 R U2 R' F R U R' U' R' F' R2" },
  { name: "T", pre: "", exec: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { name: "Ua", pre: "y2", exec: "R U' R U R U R U' R' U' R2" },
  { name: "Ub", pre: "y2", exec: "R2' U R U R' U' R3 U' R' U R'" },
  { name: "V", pre: "", exec: "R' U R' U' y R' F' R2 U' R' U R' F R F" },
  { name: "Y", pre: "", exec: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
  { name: "Z", pre: "", exec: "M' U' M2 U' M2 U' M' U2 M2" },
].map((c) => ({ ...c, alts: [] }));

export const PLL_BY_NAME = Object.fromEntries(PLLS.map((c) => [c.name, c]));
export const PLL_GROUPS = {
  "G": ["Ga", "Gb", "Gc", "Gd"], "A/E": ["Aa", "Ab", "E"], "R/J/T/F": ["Ra", "Rb", "Ja", "Jb", "T", "F"],
  "N/V/Y": ["Na", "Nb", "V", "Y"], "U/H/Z": ["Ua", "Ub", "H", "Z"],
};
