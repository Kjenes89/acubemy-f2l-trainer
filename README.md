# F2L-trener (acubemy-plugin)

Privat treningsverktøy for Vegard, bygd som plugin i [acubemy](https://acubemy.com) med [plugin-SDK v1](https://github.com/acubemy/plugin-sdk).
acubemy tar seg av Bluetooth-tilkoblingen; pluginen får trekk og kubetilstand.

**Idé:** F2L-drill der bare den valgte algoritmen per case teller. Løser du casen på en annen måte, blir den ikke godkjent og kommer igjen. I guidet modus vises algoritmen trekk for trekk, med angre-beskjed ved feil trekk.

## Bruk

acubemy → Games & Plugins → Developer → `Kjenes89/acubemy-f2l-trainer@main` → Load.
Hold kuben med grønn foran og hvit ned og se på skjermen. Casen lages på den virtuelle kuben, og trekkene fra den fysiske kuben brukes på den – den fysiske kuben trenger ikke settes opp eller løses mellom casene. Tiden går fra casen vises.

## Status (M1)

- FR-spor, de 41 basic-casene i acubemy-nummerering (= solved.no), bokas nummer og side vises.
- Valgt algoritme = Vegards låste løsning der den finnes, ellers bokas (`src/cases.js`, samme som `analyse/f2l.py` i det private repoet).
- Drill og guidet modus, virtuelle caser (siste lag blandes), «Prøv igjen» / «Neste case», 3D-kube med animasjon og gyro, statistikk for økta.
- Lagres ikke ennå (sandkassen blokkerer localStorage); kommer i M2 via egen tjeneste.

## Kode

- `src/cube.js` – fasettmodell (Kociemba URFDLB, kubens egen ramme: hvit = U).
- `src/alg.js` – algoritme i grepet (hvit ned, grønn foran) → flatetrekk i kubens ramme; rotasjoner, brede trekk og slices.
- `src/cases.js` – casene og algoritmene.
- `src/solve.js` – ren løsningslogikk: sporing av forventet trekkrekke, AUF, sammenligning mot valgt algoritme inkl. grep/rotasjoner.
- `src/app.js` – moduser (Learn, Drill, Recap, Weighted, På rad, Gjenkjenning, Predict, Guidet), planblokker, visning.
- `src/log.js` – logging til Cloudflare Worker (→ privat repo `cube-data`).
- `plans/plan.json` – dagens blokker: `{id, trainer:"f2l", name, cases, mode, minutes, slots}` (`slots` f.eks. `["FL","BR"]`, standard `["FR"]`; bare caser med avtalt løsning i `SLOT_ALGS` kommer); `mode` = drill | weighted | learn | recog | predict (med `minutes`), rad (`n`, `order`) | recap (`repeat`, `instant`, `order`) med `minutes` eller én runde.
- `src/view.js` – tegning av casen slik kuben holdes.
- `tests/core.test.mjs` – `node tests/core.test.mjs` (+ `solve.test.mjs`, `predict.test.mjs`): kubemodell, rotasjoner, alle 41 caser (valgt alg løser oppsettet, bokas alg løser samme case, ingen duplikater).
