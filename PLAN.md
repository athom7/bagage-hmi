# Plan: Bagage-HMI – browserbaseret HMI-simulator af et bagagesorteringsanlæg

## Kontekst
Portfolio-projekt til en automationsteknikerlærlingeplads. Formålet er at vise *PLC-tænkning* over for en rekrutterer/mester: adskilt I/O, scancyklus, IEC 61131-3 Structured Text, sporing af emner, interlocks og alarmhåndtering. Det skal køre gratis på Netlify som ren statisk side.

**Placering:** Eget offentligt repo `athom7/bagage-hmi`, filerne ligger i roden.


**Sprog:** UI og README på dansk. Kode, kommentarer og tag-navne på engelsk, som i industrien.

---

## Anlægget (layout)

```
[Skranke 1]─CI1─┐
                ├─ MERGE ─── Hovedbånd (MAIN) ──[ATR-scanner]──D1────D2────D3──▶ Problemtaske-station
[Skranke 2]─CI2─┘                                              │     │     │     (ugyldig destination)
                                                               G1    G2    G3   ← gate-bånd (akkumulering + læsser)
```

| Komponent | Input (sensor) | Output (aktuator) |
|---|---|---|
| Check-in-bånd 1/2 | `I_PE_CI1`, `I_PE_CI2` (fotocelle ved båndets ende) | `Q_M_CI1`, `Q_M_CI2` |
| Merge-zone | `I_PE_Merge` | – |
| Hovedbånd | – | `Q_M_Main` |
| ATR-scanner (læser bagagemærket) | `I_ATR_Read` (puls), `I_ATR_Dest` (INT: 1–3, 0 = ingen/ugyldig) | – |
| Klap 1–3 | `I_PE_D1..3` (før klappen), `I_Div1..3_Ext` (endestop-feedback) | `Q_Div1..3` |
| Gate-bånd 1–3 | `I_PE_G1..3` (fuld-fotocelle) | `Q_M_G1..3` |
| Betjening | `I_EStop_OK` (NC-kontakt: TRUE = OK), `I_Start`, `I_Stop`, `I_Reset` | `Q_Lamp_Run`, `Q_Lamp_Fault` |

Ugyldige kufferter (≈10 %, fx ulæseligt mærke eller fly ikke i flytabellen) kører forbi alle klapper til problemtaske-stationen – sådan gøres det i rigtige anlæg (manuel kodning).

---

## Arkitektur

Tre lag med én retning for data – samme opdeling som felt / I/O-kort / CPU i et rigtigt anlæg:

```
 PLANT (felt)            I/O-BILLEDE              PLC (CPU)                   HMI
 fysik, kufferter  ──▶  readInputs()  ──▶  ST-program på billedet  ──▶ writeOutputs() ──▶ PLANT
 rAF-loop (60 fps)       %I-tabel              hver 100 ms                   %Q-tabel
        ▲                                                                         
        └──────── HMI-knapper er "feltudstyr" (nødstop, start) → bliver input ved næste scan
 HMI læser kun (tags + plant-tilstand) og tegner; den skriver aldrig direkte til outputs.
```

### Filstruktur
```
bagage-hmi/
├── CLAUDE.md              projektregler (indhold nedenfor)
├── README.md              til rekrutterer (fase 3)
├── netlify.toml           publish = "."
├── index.html
├── css/hmi.css
├── plc/program.st         ← AL styringslogik, Structured Text
├── js/
│   ├── main.js            opstart: indlæs program.st, start plant-loop + scancyklus
│   ├── plant/             FELTET – ved intet om PLC'en
│   │   ├── layout.js      geometri: bånd, positioner af fotoceller/klapper (meter)
│   │   ├── plant.js       fysik: bånd kører kun når motor-output er TRUE, akkumulering, overførsel
│   │   ├── bag.js         kuffert: id, fly, destination, vægt, planlagt + faktisk rute
│   │   └── flights.js     flytabel (fly → gate) og kuffertgenerator
│   ├── io/
│   │   ├── tags.js        tag-tabel: navn, type, retning (I/Q), IEC-adresse (%I0.0), beskrivelse
│   │   └── io.js          readInputs(plant, image) / writeOutputs(image, plant)
│   ├── plc/
│   │   ├── scan.js        scancyklus 100 ms: read → execute → write, cyklustid, RUN/STOP
│   │   └── st/
│   │       ├── lexer.js
│   │       ├── parser.js  → AST med linjenumre
│   │       ├── interpreter.js
│   │       └── stdlib.js  TON, TOF, R_TRIG, F_TRIG, CTU, FIFO
│   └── hmi/
│       ├── render.js      SVG-tegning af anlæg + kufferter
│       ├── infopanel.js   klik-info for kuffert/komponent
│       ├── stview.js      ST-kode med live-værdier (som "online"-visning i TIA/Codesys)
│       ├── controls.js    start/stop/nødstop/reset, ny kuffert, fejl-knapper
│       └── alarms.js      alarmliste (fase 3)
└── tests/                 node --test (ingen afhængigheder)
    ├── st-interpreter.test.js
    └── scan.test.js
```

### Nøglebeslutninger
- **SVG** til anlægget: skarpt i alle størrelser, og hvert element er klikbart med egen DOM-node.
- **Plant og PLC kører i hver sin løkke:** fysik i `requestAnimationFrame` (glat bevægelse), PLC i `setInterval(100)`. Fysikken bruger altid de seneste outputs – præcis som et rigtigt anlæg mellem to scans.
- **ST-dialekt (delmængde):** `PROGRAM … END_PROGRAM`, `VAR … END_VAR`, typer `BOOL`/`INT`/`TIME` (`T#5s`), `:=`, `IF/ELSIF/ELSE/END_IF`, `CASE … OF … END_CASE`, `AND/OR/XOR/NOT`, sammenligninger, `+ - * / MOD`, kommentarer `(* *)` og `//`, kald af funktionsblokke `Tmr(IN := x, PT := T#5s); Tmr.Q`. I/O-tags kommer fra `tags.js` og deklareres ikke igen i ST.
- **Kuffertsporing:** ATR-scanneren lægger destinationen i en `FIFO` (skifteregister). Ved stigende flanke på `I_PE_D1` tager klap 1 hovedet af køen: er det 1 → slå klap ud, ellers send videre til næste klaps FIFO. Kufferter kan ikke overhale hinanden, så rækkefølgen holder. `FIFO` er en ikke-standard blok i `stdlib.js` – dokumenteres som svarende til biblioteksblokke i fx Codesys/OSCAT.
- **"Logiklinjen" for en komponent:** Parseren noterer, hvilke linjer der skriver til hvert output. Klik på klap 2 viser fx linje 84–88 i `program.st` med live-værdier for hver variabel.
- **Fejl i ST = CPU i STOP:** Parse- og kørselsfejl sætter PLC'en i STOP, alle outputs går FALSE, og fejlen vises med linjenummer.
- **Nødstop som NC-input** (`I_EStop_OK`): kabelbrud stopper også anlægget. Efter udløsning kræves `Reset` (selvhold), før man kan starte igen.
- **Merge-logik:** Skranker skiftes til at sende (fairness) og venter, til merge-zonen har været fri i 700 ms *kørende* hovedbånd (`TON`). Det giver luft mellem kufferterne.

---

## Fase 1 – weekend 1: Visuelt anlæg, bevægelse, klik-info
1. Opret `netlify.toml`, `index.html` med layout: statuslinje øverst, anlæg i midten, infopanel til højre og en plads til alarmlisten forneden.
2. `layout.js` + `plant.js`: bånd som segmenter (længde, hastighed), kufferter med position, akkumulering (ingen overlap), overførsel mellem bånd, klap med 300 ms gangtid og feedback.
3. `tags.js` + `io.js`: hele I/O-billedet bygges allerede nu.
4. **Midlertidig `js/plc/stub-logic.js`** skriver til *samme* output-billede (markeret `// TEMP phase 1 – replaced by program.st`). Når den byttes ud i fase 2, beviser det, at I/O-adskillelsen virker.
5. `render.js`: SVG-anlæg og kufferter i bevægelse. Farver: motor kører/står, fotocelle brudt/fri, klap ude/inde.
6. `infopanel.js`: Klik på en kuffert viser fly, destination, vægt og rute (planlagt + nuværende position). Klik på en komponent viser tilstand og I/O-adresse (logiklinjen får en pladsholder, indtil fase 2).
7. "Ny kuffert"-knap ved hver skranke + auto-generering med justerbar rate.

**Færdig når:** Kufferter fra begge skranker kører synligt til den rigtige gate, ugyldige kufferter havner på problemstationen, og alle klik viser info.

## Fase 2 – weekend 2: Scancyklus, sensorer, ST-logik
1. ST-lexer, parser og fortolker + `stdlib.js`, testet med `node --test` (udtryk, IF/CASE, TON-timing, R_TRIG, FIFO, fejlmeddelelser med linjenummer).
2. `plc/program.st`: hele logikken (driftstilstand Start/Stop/Reset/nødstop, check-in + merge, ATR → FIFO-sporing, klapper, gate-bånd, stop af hovedbånd hvis næste kuffert skal til en fuld gate).
3. `scan.js`: 100 ms-cyklus med tydeligt adskilte `readInputs()` → `execute()` → `writeOutputs()`. Statuslinjen viser RUN/STOP, antal scans og målt cyklustid. Pause og enkelt-scan-knap til fejlfinding.
4. Slet `stub-logic.js`.
5. `stview.js`: ST-panel med syntaksfarver og live-værdier. Komponent-klik viser og fremhæver den styrende logiklinje.
6. Betjeningspanel: Start, Stop, Nødstop (slå ind/ud), Reset.

**Færdig når:** Anlægget opfører sig som i fase 1, men nu styret af `program.st`. Testene er grønne, en ændring i `program.st` ændrer adfærden, og en syntaksfejl sender CPU'en i STOP.

## Fase 3 – weekend 3: Alarmer, finpudsning, README, deploy
1. Alarmbits i ST (`ALM_Queue_Main`, `ALM_Queue_G1..3`, `ALM_InvalidDest`, `ALM_EStop`, `ALM_DivFault1..3`, hvis klap-feedback udebliver). `alarms.js` overvåger bittene, som HMI-bitalarmer i WinCC.
2. Alarmliste: tidsstempel for kommet/gået, klasse (Fejl/Advarsel), tekst og tilstand (aktiv-ukvitteret → aktiv-kvitteret → gået) i ISA-18.2-stil. Kvittér én/alle, alarmtæller og blinkende banner i statuslinjen.
3. Panelet "Fremprovokér fejl": blokér gate-læsser (kø), send kuffert med ugyldigt mærke, nødstop, klap sidder fast. Så kan rekrutteren selv se reaktionen.
4. Finpudsning: tegnforklaring, responsivt layout (bærbar + tablet), tastaturbetjening, favicon og en "Om projektet"-boks.
5. README.md (dansk, til rekrutterer): hvad og hvorfor, screenshot/GIF, arkitekturdiagram, tabel over *"PLC-begreb → hvor det ses i projektet"* (scancyklus, procesbillede, flankedetektering, timere, selvhold, NC-nødstop, sporing, alarmkvittering), hvordan man kører det, bevidste forenklinger og live-link.
6. Deploy: Netlify Drop (træk mappen ind) eller Git-tilknytning til repoet (ingen base directory). Live-URL sættes ind i README.

**Færdig når:** Live-URL'en virker uden konsolfejl, og README'en linker til den.

---

## Indhold til `CLAUDE.md` (allerede skrevet – flyttes til det nye repo)

Se `CLAUDE.md`.

---

## Verifikation (hver fase)
- `node --test tests/` → alle grønne (fra fase 2).
- `python3 -m http.server 8080` og et Playwright-røgtest-script i scratchpad (bruger den forudinstallerede Chromium, committes ikke). Det tjekker: siden loader uden konsolfejl, kufferter når frem til den rigtige gate, nødstop stopper alle motorer inden for ét scan, og et klik åbner infopanelet. Screenshots sendes til dig.
- Fase 3: Netlify-URL'en åbnes og testes på samme måde.

## Hent projektet til din Mac
Første gang (forudsætter at mappen `bagage-hmi` er tom eller ikke findes endnu):
```bash
cd ~/"Claude Code projekter"
git clone https://github.com/athom7/bagage-hmi.git bagage-hmi
```
Efter hver fase: `cd ~/"Claude Code projekter"/bagage-hmi && git pull`

## Netlify
Tilknyt `athom7/bagage-hmi` direkte. Base directory skal være tomt, og publish directory er `.`.

