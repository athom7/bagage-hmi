// Plant geometry: belts, sensors, diverters and counters.
// Pure data + helpers. Knows nothing about the PLC, tags or the DOM.
// All lengths are SVG units (1 unit is roughly 2.5 cm of real conveyor).

export const GAP = 4; // minimum free space between two bags (units)

function buildBelt(def) {
  let acc = 0;
  def.segs = [];
  for (let i = 0; i < def.path.length - 1; i++) {
    const [x1, y1] = def.path[i];
    const [x2, y2] = def.path[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    def.segs.push({ x1, y1, x2, y2, len, start: acc, angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI });
    acc += len;
  }
  def.length = acc;
  return def;
}

// explainDa: 1–2 sentences (Danish, shown in the HMI) about the real-world counterpart and why it matters.
const EXPLAIN_CHECKIN = 'I en rigtig lufthavn tager et kort bånd kufferten fra skranken og ind bag væggen, hvor det automatiske anlæg overtager. Passageren ser den først igen ved bagagebåndet på destinationen.';

export const BELTS = {
  CI1: buildBelt({ id: 'CI1', name: 'Check-in-bånd 1', path: [[70, 100], [250, 100], [330, 180]], speed: 90, next: 'MAIN', explainDa: EXPLAIN_CHECKIN }),
  CI2: buildBelt({ id: 'CI2', name: 'Check-in-bånd 2', path: [[70, 260], [250, 260], [330, 180]], speed: 90, next: 'MAIN', explainDa: EXPLAIN_CHECKIN }),
  MAIN: buildBelt({
    id: 'MAIN', name: 'Hovedbånd', path: [[330, 180], [1110, 180]], speed: 120, next: null, sink: true,
    explainDa: 'Sorteringsbåndet samler kufferter fra alle skranker. I store lufthavne er det kilometervis af bånd, og et stop her rammer mange afgange på én gang. Derfor skal logikken være robust.',
  }),
};

// Diverters sit on the main belt; each one feeds a gate belt running downwards.
const EXPLAIN_DIVERTER = 'En klap (pusher eller svingarm) skubber kufferten af hovedbåndet og ind på det rigtige gate-bånd. Den drives af trykluft eller motor, og et endestop melder tilbage til PLC\'en, når den er helt ude. Uden den melding ved styringen ikke, om klappen faktisk virker.';

export const DIVERTERS = [
  { id: 1, pos: 270, x: 600, explainDa: EXPLAIN_DIVERTER },
  { id: 2, pos: 470, x: 800, explainDa: EXPLAIN_DIVERTER },
  { id: 3, pos: 670, x: 1000, explainDa: EXPLAIN_DIVERTER },
];

for (const d of DIVERTERS) {
  BELTS['G' + d.id] = buildBelt({
    id: 'G' + d.id, name: `Gate-bånd ${d.id}`, path: [[d.x, 180], [d.x, 420]], speed: 80, next: null, sink: false,
    explainDa: 'Gate-båndet (kaldet make-up) er der, hvor bagagehåndtererne læsser kufferterne i vogne eller containere til ét bestemt fly. Bliver det fuldt, må anlægget vente, ellers ender kufferter ved det forkerte fly eller på gulvet.',
  });
}

export const BELT_ORDER = ['G1', 'G2', 'G3', 'MAIN', 'CI1', 'CI2']; // downstream first

const EXPLAIN_COUNTER = 'Ved skranken bliver kufferten vejet og får et bagagemærke med en 10-cifret stregkode, som kobler den til passagerens booking. Det nummer bruger anlægget til at finde det rigtige fly.';

export const COUNTERS = {
  CI1: { comp: 'SKR1', name: 'Skranke 1', x: 4, y: 76, w: 62, h: 48, explainDa: EXPLAIN_COUNTER },
  CI2: { comp: 'SKR2', name: 'Skranke 2', x: 4, y: 236, w: 62, h: 48, explainDa: EXPLAIN_COUNTER },
};

// Photocells. blocked = beam interrupted by a bag. `reach` widens the detection field on both sides (default: a thin beam).
const ciPos = BELTS.CI1.length - 45;
export const SENSORS = [
  ...['CI1', 'CI2'].map((b, i) => ({
    id: `PE_${b}`, tag: `I_PE_${b}`, belt: b, pos: ciPos, name: `Fotocelle check-in ${i + 1}`,
    desc: `Registrerer en kuffert ved enden af check-in-bånd ${i + 1}, før sammenfletningen.`,
    explainDa: 'Fotoceller er anlæggets øjne: en lysstråle, som kufferten bryder. Her holder den kufferten tilbage ved enden af båndet, så PLC\'en bestemmer, hvornår den må flette ind.',
  })),
  {
    id: 'PE_Merge', tag: 'I_PE_Merge', belt: 'MAIN', pos: 14, name: 'Fotocelle sammenfletning',
    desc: 'Registrerer at en kuffert er kommet ind på hovedbåndet fra et af check-in-båndene.',
    explainDa: 'Hvor to bånd mødes, skal der være luft mellem kufferterne, ellers kan anlægget ikke skelne dem fra hinanden længere fremme. Fotocellen fortæller PLC\'en, hvornår flettepunktet er frit.',
  },
  ...DIVERTERS.map((d) => ({
    id: `PE_D${d.id}`, tag: `I_PE_D${d.id}`, belt: 'MAIN', pos: d.pos - 50,
    name: `Fotocelle før klap ${d.id}`, desc: `Sidder 50 enheder før klap ${d.id}, så klappen når at slå ud, inden kufferten ankommer.`,
    explainDa: 'Fotocellen før en klap er øjeblikket, hvor anlægget beslutter, om kufferten skal af her. Afstanden til klappen er regnet ud fra båndets hastighed og klappens gangtid, så klappen er ude i tide.',
  })),
  ...DIVERTERS.map((d) => ({
    id: `PE_G${d.id}`, tag: `I_PE_G${d.id}`, belt: 'G' + d.id, pos: BELTS['G' + d.id].length - 85,
    // Diffuse sensor with a wide detection field: it must not "see through" the small gaps between stationary bags.
    reach: 8,
    explainDa: 'En fuld-føler fortæller, at der ikke er plads til flere kufferter på gate-båndet. Så er det bedre at lade hovedbåndet vente end at skubbe en kuffert ind på et fyldt bånd.',
    name: `Fuld-føler gate ${d.id}`, desc: `Afbrudt, når der står tre kufferter eller flere på gate-bånd ${d.id}, dvs. båndet er ved at være fuldt. Føleren har et bredt detektionsfelt, så den ikke slipper igennem mellemrum mellem stillestående kufferter.`,
  })),
];

// ATR = automatic tag reader (bag tag scanner) above the main belt.
export const ATR = {
  id: 'ATR', belt: 'MAIN', pos: 100,
  explainDa: 'ATR står for Automatic Tag Reader: en ring af stregkodelæsere, der læser bagagemærket fra alle sider, mens kufferten kører forbi. Langt de fleste mærker bliver læst, men resten skal sorteres manuelt, og det er hele grunden til problemtaske-stationen.',
};

// Problem bag station at the end of the main belt (bags no diverter took).
export const REJECT = {
  id: 'REJ', belt: 'MAIN',
  explainDa: 'Kufferter, anlægget ikke kan sortere (ulæseligt mærke, ukendt fly eller fejl undervejs), ender på en manuel kodestation. En medarbejder taster destinationen ind, og kufferten sendes ind i anlægget igen.',
};

export function pointAt(belt, pos) {
  const p = Math.max(0, Math.min(belt.length, pos));
  const seg = belt.segs.find((s) => p <= s.start + s.len) || belt.segs[belt.segs.length - 1];
  const t = seg.len ? (p - seg.start) / seg.len : 0;
  return { x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t, angle: seg.angle };
}
