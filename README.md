# F2L-trener (acubemy-plugin)

Privat treningsverktøy for Vegard, bygd som plugin i [acubemy](https://acubemy.com) med [plugin-SDK v1](https://github.com/acubemy/plugin-sdk).
acubemy tar seg av Bluetooth-tilkoblingen; pluginen får trekk og kubetilstand.

**Idé:** F2L-drill der bare den valgte algoritmen per case teller. Løser du casen på en annen måte, blir den ikke godkjent og kommer igjen. I guidet modus vises algoritmen trekk for trekk, med angre-beskjed ved feil trekk.

## Bruk

acubemy → Games & Plugins → Developer → `Kjenes89/acubemy-f2l-trainer@main` → Load.
Hold kuben med hvit ned og grønn foran. Løs F2L, så kommer oppsettet; utfør det, og casen starter (tiden går fra casen vises).

## Status (M1)

- FR-spor, de 41 basic-casene i acubemy-nummerering (= solved.no), bokas nummer og side vises.
- Valgt algoritme = Vegards låste løsning der den finnes, ellers bokas (`src/cases.js`, samme som `analyse/f2l.py` i det private repoet).
- Drill og guidet modus, oppsett med blandet siste lag (eller kort oppsett), statistikk for økta.
- Lagres ikke ennå (sandkassen blokkerer localStorage); kommer i M2 via egen tjeneste.

## Kode

- `src/cube.js` – fasettmodell (Kociemba URFDLB, kubens egen ramme: hvit = U).
- `src/alg.js` – algoritme i grepet (hvit ned, grønn foran) → flatetrekk i kubens ramme; rotasjoner, brede trekk og slices.
- `src/cases.js` – casene og algoritmene.
- `src/view.js` – tegning av casen slik kuben holdes.
- `tests/core.test.mjs` – `node tests/core.test.mjs`: kubemodell, rotasjoner, alle 41 caser (valgt alg løser oppsettet, bokas alg løser samme case, ingen duplikater).
