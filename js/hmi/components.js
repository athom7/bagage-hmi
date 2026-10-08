// HMI knowledge about the plant's components: names, descriptions and which tags belong to each.
// Used by the render layer (click targets) and the info panel.

import { BELTS, SENSORS, DIVERTERS, COUNTERS, ATR, REJECT } from '../plant/layout.js';
import { FLIGHTS } from '../plant/flights.js';

export const PLACE_NAMES = {
  CI1: 'Check-in-bånd 1',
  CI2: 'Check-in-bånd 2',
  MAIN: 'Hovedbånd',
  DIV1: 'Klap 1',
  DIV2: 'Klap 2',
  DIV3: 'Klap 3',
  G1: 'Gate-bånd 1',
  G2: 'Gate-bånd 2',
  G3: 'Gate-bånd 3',
  REJ: 'Problemtaske-station',
};

export const gateFlights = (gate) => FLIGHTS.filter((f) => f.gate === gate);

export const COMPONENTS = {};

for (const [belt, c] of Object.entries(COUNTERS)) {
  COMPONENTS[c.comp] = {
    kind: 'counter', name: c.name, belt,
    desc: `Her afleverer passageren kufferten. Den lægges på ${PLACE_NAMES[belt].toLowerCase()}. Kufferter står i kø ved skranken, hvis båndets start er optaget.`,
  };
}

for (const id of ['CI1', 'CI2']) {
  COMPONENTS[id] = {
    kind: 'belt', name: PLACE_NAMES[id], belt: id, motor: `Q_M_${id}`, sensors: [`I_PE_${id}`],
    desc: 'Fører kufferter fra skranken hen til hovedbåndet. Stopper ved enden og venter på frigivelse, så de to skranker skiftes til at flette ind.',
  };
}

COMPONENTS.MAIN = {
  kind: 'belt', name: PLACE_NAMES.MAIN, belt: 'MAIN', motor: 'Q_M_Main', sensors: ['I_PE_Merge'],
  desc: 'Bærer kufferterne forbi ATR-scanneren og de tre klapper. Kufferter, der ikke bliver slået ud, ender på problemtaske-stationen.',
};

for (const d of DIVERTERS) {
  COMPONENTS['G' + d.id] = {
    kind: 'gate', name: PLACE_NAMES['G' + d.id], belt: 'G' + d.id, gate: d.id, motor: `Q_M_G${d.id}`, sensors: [`I_PE_G${d.id}`],
    desc: `Gate ${d.id}: her står kufferterne, til en bagagehåndterer læsser dem. Fly: ${gateFlights(d.id).map((f) => `${f.code} ${f.dest}`).join(', ')}.`,
  };
  COMPONENTS['DIV' + d.id] = {
    kind: 'diverter', name: PLACE_NAMES['DIV' + d.id], div: d.id, out: `Q_Div${d.id}`, sensors: [`I_Div${d.id}_Ext`],
    desc: `Slår ud og skubber kufferten over på gate-bånd ${d.id}. Skal være helt udslået (endestop), før kufferten passerer, og trækkes tilbage bagefter.`,
  };
}

for (const s of SENSORS) {
  COMPONENTS[s.id] = { kind: 'sensor', name: s.name, sensor: s, sensors: [s.tag], desc: s.desc };
}

COMPONENTS.ATR = {
  kind: 'atr', name: 'ATR-scanner', sensors: ['I_ATR_Read', 'I_ATR_Dest'],
  desc: 'Aflæser bagagemærket på hver kuffert og slår flynummeret op i flytabellen. Giver gate-nummeret 1–3, eller 0 hvis mærket ikke kan aflæses, eller flyet ikke findes.',
};

COMPONENTS.REJ = {
  kind: 'reject', name: PLACE_NAMES.REJ, belt: 'MAIN',
  desc: 'Her ender kufferter uden gyldig destination, så de kan håndteres manuelt. Sådan gøres det også i rigtige anlæg.',
};

// Learning layer: the real-world explanation for each component comes from the plant layout data.
for (const [id, c] of Object.entries(COMPONENTS)) {
  if (c.kind === 'counter') c.explainDa = COUNTERS[c.belt].explainDa;
  else if (c.kind === 'belt' || c.kind === 'gate') c.explainDa = BELTS[c.belt].explainDa;
  else if (c.kind === 'diverter') c.explainDa = DIVERTERS.find((d) => d.id === c.div).explainDa;
  else if (c.kind === 'sensor') c.explainDa = c.sensor.explainDa;
  else if (c.kind === 'atr') c.explainDa = ATR.explainDa;
  else if (c.kind === 'reject') c.explainDa = REJECT.explainDa;
  if (!c.explainDa) throw new Error(`component ${id} has no explainDa`);
}

// Tags whose controlling lines in program.st should be shown for a component.
export function logicTagsOf(id) {
  const c = COMPONENTS[id];
  if (!c) return [];
  if (c.kind === 'belt' || c.kind === 'gate') return [c.motor];
  if (c.kind === 'diverter') return [c.out];
  if (c.kind === 'sensor' || c.kind === 'atr') return c.sensors;
  return [];
}
