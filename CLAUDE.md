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
- AL styringslogik ligger i `plc/program.st`. Der må aldrig være styringslogik i JavaScript.

## Visning: to temaer – ingen farver i JavaScript
- To visningstilstande, skiftes med knappen i statuslinjen og gemt i `localStorage`:
  - **Operatør** (standard, ISA-101): lys grå, gråtoner for normal drift. Farve kun ved unormale tilstande
    (rød = nødstop/STOP/fejl, gul = advarsel, fx ugyldig destination).
  - **Showcase**: farverig og levende, til at vise frem (gate-farver, animation).
- JavaScript sætter kun tilstandsklasser: `running`, `stopped`, `fault`, `blocked`, `extended`, `reading`,
  `bag-dest-0` … `bag-dest-3`, `bag-defect`, `selected` (og `on`/`off` for live-værdier i programvisningen).
  Temaet vælges med `data-theme` på `<html>` (`js/hmi/theme.js`).
- Alle farver ligger som tokens i `css/hmi.css` under `:root[data-theme="operator"]` og
  `:root[data-theme="showcase"]`. **Ingen farveværdier i `js/`** – en test håndhæver det.

## Læringslag (danske forklaringer som data)
- Hver fysisk komponent i `js/plant/layout.js` har `explainDa`: 1–2 sætninger om, hvad den er i en rigtig
  lufthavn, og hvorfor den betyder noget. Infopanelet viser den under "I en rigtig lufthavn".
- Hvert netværk i `program.st` (sektionsoverskrifterne `// N. TITLE`) har en dansk forklaring i
  `plc/networks.da.json`, som vises med en "Forklar"-knap i programvisningen.
- Forklaringerne er data, ikke ST-kode. Kommentarer i `program.st` forbliver engelske.
- Nye komponenter og nye netværk skal have deres forklaring med det samme (testene fejler ellers).

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

## Designregler fra fejlsøgning (dækket af tests, bryd dem ikke)
- En fotocelle scannes hvert 100 ms. To kufferter med under ca. 10 enheders mellemrum bliver til én for PLC'en
  og ødelægger sporingskøerne. Skranken afleverer derfor med minimum 80 enheders afstand (`SPAWN_GAP`),
  og sammenfletningen frigiver først en ny kuffert efter 700 ms *kørende* hovedbånd.
- Tidtagning i logikken (mellemrum, tilbagetrækning af klap) må kun tælle, mens hovedbåndet kører (`M_MainOk`).
  Ellers trækkes en klap tilbage, før kufferten er nået frem, når båndet holder eller står stille.
- Hver kuffert får sin egen klap-beslutning ved fotocellen (`M_WantN := FIFO_N.OUT = N`), så en klap aldrig
  står ude for næste kuffert. Timeren trækker kun klappen tilbage efter den *sidste* kuffert.
- Fuld-føleren på gate-båndene har bredt detektionsfelt (`reach`), ellers kan en punktstråle ende i et mellemrum.
- Nødstop afbryder motorerne hårdt i `plant.js` (sikkerhedskreds), og PLC'en læser samme signal for tilstand og alarm.

## Arbejdsgang
- Projektet bygges i tre faser (se `PLAN.md`). Byg kun den aktuelle fase – spring ikke frem.
- Status: fase 1 og 2 er færdige, inkl. visningstilstande og læringslag. Fase 3 (alarmer, finpudsning, README, deploy) er næste.
- Hver ny ST-sprogfeature og funktionsblok skal have en test i `tests/`.
- Kør `node --test tests/` og åbn siden lokalt uden konsolfejl før commit.
- Små, beskrivende commits på engelsk.
- Kommentér ST-koden som en PLC-programmør ville: hvad netværket gør, og hvorfor (interlocks, sikkerhed).
