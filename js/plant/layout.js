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

export const BELTS = {
  CI1: buildBelt({ id: 'CI1', name: 'Check-in-bånd 1', path: [[70, 100], [250, 100], [330, 180]], speed: 90, next: 'MAIN' }),
  CI2: buildBelt({ id: 'CI2', name: 'Check-in-bånd 2', path: [[70, 260], [250, 260], [330, 180]], speed: 90, next: 'MAIN' }),
  MAIN: buildBelt({ id: 'MAIN', name: 'Hovedbånd', path: [[330, 180], [1110, 180]], speed: 120, next: null, sink: true }),
};

// Diverters sit on the main belt; each one feeds a gate belt running downwards.
export const DIVERTERS = [
  { id: 1, pos: 270, x: 600 },
  { id: 2, pos: 470, x: 800 },
  { id: 3, pos: 670, x: 1000 },
];

for (const d of DIVERTERS) {
  BELTS['G' + d.id] = buildBelt({ id: 'G' + d.id, name: `Gate-bånd ${d.id}`, path: [[d.x, 180], [d.x, 420]], speed: 80, next: null, sink: false });
}

export const BELT_ORDER = ['G1', 'G2', 'G3', 'MAIN', 'CI1', 'CI2']; // downstream first

export const COUNTERS = {
  CI1: { comp: 'SKR1', name: 'Skranke 1', x: 4, y: 76, w: 62, h: 48 },
  CI2: { comp: 'SKR2', name: 'Skranke 2', x: 4, y: 236, w: 62, h: 48 },
};

// Photocells. blocked = beam interrupted by a bag.
const ciPos = BELTS.CI1.length - 45;
export const SENSORS = [
  { id: 'PE_CI1', tag: 'I_PE_CI1', belt: 'CI1', pos: ciPos, name: 'Fotocelle check-in 1', desc: 'Registrerer en kuffert ved enden af check-in-bånd 1, før sammenfletningen.' },
  { id: 'PE_CI2', tag: 'I_PE_CI2', belt: 'CI2', pos: ciPos, name: 'Fotocelle check-in 2', desc: 'Registrerer en kuffert ved enden af check-in-bånd 2, før sammenfletningen.' },
  { id: 'PE_Merge', tag: 'I_PE_Merge', belt: 'MAIN', pos: 14, name: 'Fotocelle sammenfletning', desc: 'Registrerer at en kuffert er kommet ind på hovedbåndet fra et af check-in-båndene.' },
  ...DIVERTERS.map((d) => ({
    id: `PE_D${d.id}`, tag: `I_PE_D${d.id}`, belt: 'MAIN', pos: d.pos - 50,
    name: `Fotocelle før klap ${d.id}`, desc: `Sidder 50 enheder før klap ${d.id}, så klappen når at slå ud, inden kufferten ankommer.`,
  })),
  ...DIVERTERS.map((d) => ({
    id: `PE_G${d.id}`, tag: `I_PE_G${d.id}`, belt: 'G' + d.id, pos: BELTS['G' + d.id].length - 85,
    name: `Fuld-fotocelle gate ${d.id}`, desc: `Afbrudt, når der står tre kufferter eller flere på gate-bånd ${d.id}, dvs. båndet er ved at være fuldt.`,
  })),
];

// ATR = automatic tag reader (bag tag scanner) above the main belt.
export const ATR = { id: 'ATR', belt: 'MAIN', pos: 100 };

export function pointAt(belt, pos) {
  const p = Math.max(0, Math.min(belt.length, pos));
  const seg = belt.segs.find((s) => p <= s.start + s.len) || belt.segs[belt.segs.length - 1];
  const t = seg.len ? (p - seg.start) / seg.len : 0;
  return { x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t, angle: seg.angle };
}
