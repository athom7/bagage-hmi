// Tag table: the single place where all I/O points are defined.
// Naming: I_ input, Q_ output. PE = photocell, M = motor, Div = diverter, CI = check-in, G = gate belt.
// Photocells: TRUE = beam interrupted (bag present).
// Emergency stop is a normally-closed circuit: I_EStop_OK = TRUE means OK, FALSE means pressed or wire break.

const bool = (name, desc) => ({ name, type: 'BOOL', desc });
const int = (name, desc) => ({ name, type: 'INT', desc });
const each = (n, fn) => Array.from({ length: n }, (_, i) => fn(i + 1));

const INPUTS = [
  bool('I_EStop_OK', 'Nødstop-kreds OK (NC-kontakt: TRUE = OK, FALSE = udløst eller ledningsbrud)'),
  bool('I_Start', 'Trykknap Start'),
  bool('I_Stop', 'Trykknap Stop'),
  bool('I_Reset', 'Trykknap Reset/kvittering'),
  bool('I_PE_CI1', 'Fotocelle ved enden af check-in-bånd 1 (TRUE = afbrudt)'),
  bool('I_PE_CI2', 'Fotocelle ved enden af check-in-bånd 2 (TRUE = afbrudt)'),
  bool('I_PE_Merge', 'Fotocelle ved sammenfletningen på hovedbåndet (TRUE = afbrudt)'),
  bool('I_ATR_Read', 'ATR-scanner har aflæst et bagagemærke (puls på ca. 150 ms)'),
  ...each(3, (k) => bool(`I_PE_D${k}`, `Fotocelle før klap ${k} (TRUE = afbrudt)`)),
  ...each(3, (k) => bool(`I_Div${k}_Ext`, `Endestop: klap ${k} er helt udslået`)),
  ...each(3, (k) => bool(`I_PE_G${k}`, `Fuld-føler på gate-bånd ${k} (TRUE = afbrudt)`)),
  int('I_ATR_Dest', 'Gate-nummer fra seneste aflæsning (1–3, 0 = ingen eller ugyldig destination)'),
];

const OUTPUTS = [
  bool('Q_M_CI1', 'Motor check-in-bånd 1'),
  bool('Q_M_CI2', 'Motor check-in-bånd 2'),
  bool('Q_M_Main', 'Motor hovedbånd'),
  ...each(3, (k) => bool(`Q_Div${k}`, `Slå klap ${k} ud`)),
  ...each(3, (k) => bool(`Q_M_G${k}`, `Motor gate-bånd ${k}`)),
  bool('Q_Lamp_Run', 'Lampe: anlæg i drift'),
  bool('Q_Lamp_Fault', 'Lampe: fejl'),
];

// IEC addresses: BOOLs are packed bytewise (%I0.0 ...), INTs are words placed after them on an even byte.
function assign(defs, dir) {
  const bools = defs.filter((d) => d.type === 'BOOL');
  let bytes = Math.ceil(bools.length / 8);
  let word = bytes + (bytes % 2);
  let nb = 0;
  return defs.map((d) => {
    let addr;
    if (d.type === 'BOOL') {
      addr = `%${dir}${Math.floor(nb / 8)}.${nb % 8}`;
      nb++;
    } else {
      addr = `%${dir}W${word}`;
      word += 2;
    }
    return { ...d, dir, addr };
  });
}

export const TAGS = [...assign(INPUTS, 'I'), ...assign(OUTPUTS, 'Q')];
export const TAG_BY_NAME = Object.fromEntries(TAGS.map((t) => [t.name, t]));

// The I/O image: one value per tag. Inputs are frozen during the program run, outputs are written to the field afterwards.
export function createImage() {
  const image = { I: {}, Q: {} };
  for (const t of TAGS) image[t.dir][t.name] = t.type === 'INT' ? 0 : false;
  return image;
}

export function tagValue(image, name) {
  const t = TAG_BY_NAME[name];
  return image[t.dir][name];
}
