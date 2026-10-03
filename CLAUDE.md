# Bagage-HMI – projektregler

Browserbaseret HMI-simulator af et bagagesorteringsanlæg. Portfolio-projekt til en
automationsteknikerlærlingeplads: logikken skal ligne rigtig PLC-tænkning, ikke webapp-tænkning.

## Teknik – faste rammer
- Kun HTML, CSS og vanilla JavaScript (ES-moduler). Ingen frameworks, ingen bundler, ingen build-step.
- Ingen backend, API-nøgler, betalte tjenester eller CDN-afhængigheder. Siden skal virke offline.
- Skal kunne deployes som statisk mappe på Netlify (`netlify.toml`, publish = ".").
- Kør lokalt med en statisk server (fetch af program.st kræver http):
  `python3 -m http.server 8080` i mappen → http://localhost:8080
- Tests: `node --test tests/` (Nodes indbyggede testrunner, ingen npm-pakker).
- Nye afhængigheder kræver min godkendelse først.

## Sprog
- UI-tekster og README: dansk.
- Kode, kommentarer, tag-navne, commit-beskeder: engelsk.

## Arkitektur – lagdelingen må ikke brydes
- `js/plant/` = feltet (fysik, kufferter). Kender intet til PLC eller ST.
- `js/io/` = procesbilledet. Kun `readInputs()` læser fra plant, kun `writeOutputs()` skriver til plant.
- `js/plc/` = CPU'en. ST-programmet arbejder KUN på I/O-billedet, aldrig direkte på plant eller DOM.
- `js/hmi/` = visning. Læser tags og plant-tilstand. Operatørknapper (start, stop, nødstop, reset)
  er feltudstyr: de ændrer plant-tilstand, som bliver input ved næste scan.
- AL styringslogik ligger i `plc/program.st`. Der må aldrig være styringslogik i JavaScript
  (undtagen den midlertidige stub i fase 1, som slettes i fase 2).

## Scancyklus
- Fast cyklus på 100 ms: `readInputs()` → `execute()` → `writeOutputs()`. Rækkefølgen ændres aldrig.
- Inputs er frosset under execute. Outputs skrives først til plant efter hele programmet har kørt.
- Parse- eller kørselsfejl → CPU i STOP, alle outputs FALSE, fejl vises med linjenummer.

## Tag-konventioner
- `I_` input, `Q_` output, `M_` intern hukommelse, `ALM_` alarmbit. Fx `I_PE_D1`, `Q_M_Main`, `Q_Div2`.
- `PE` = fotocelle, `M` (efter Q_) = motor, `Div` = klap, `CI` = check-in, `G` = gate-bånd.
- Alle I/O-tags defineres ét sted: `js/io/tags.js`, med IEC-adresse (%I0.0 / %Q0.0) og beskrivelse.
- Nødstop er NC: `I_EStop_OK = TRUE` betyder OK.

## Understøttet ST (hold dig inden for dette – udvid kun med test)
PROGRAM/END_PROGRAM, VAR/END_VAR, BOOL/INT/TIME (T#500ms, T#5s), :=, IF/ELSIF/ELSE/END_IF,
CASE/OF/END_CASE, AND/OR/XOR/NOT, = <> < <= > >=, + - * / MOD, (* *) og // kommentarer.
Funktionsblokke: TON, TOF, R_TRIG, F_TRIG, CTU, FIFO (FIFO er en forenkling, ikke IEC-standard).

## Arbejdsgang
- Projektet bygges i tre faser (se `PLAN.md`). Byg kun den aktuelle fase – spring ikke frem.
- Hver ny ST-sprogfeature og funktionsblok skal have en test i `tests/`.
- Kør `node --test tests/` og åbn siden lokalt uden konsolfejl før commit.
- Små, beskrivende commits på engelsk.
- Kommentér ST-koden som en PLC-programmør ville: hvad netværket gør, og hvorfor (interlocks, sikkerhed).
