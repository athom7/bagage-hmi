// Alarm log: turns alarm bits into alarms with time stamps and acknowledgement, like bit alarms in an HMI/SCADA.
// Pure logic (no DOM), so it can be tested in Node. The HMI polls the bits in its own update cycle, as a real
// operator panel polls the PLC: the PLC only sets bits, the HMI owns time stamps, texts and acknowledgement.
//
// States per alarm (ISA-18.2):
//   active-unack  -> the bit is TRUE, nobody has acknowledged it yet (flashes)
//   active-ack    -> the bit is TRUE, the operator has seen it
//   cleared-unack -> the bit went FALSE before anyone acknowledged it: it stays until acknowledged
//   (cleared and acknowledged -> moved to the history)

// Alarm texts are HMI data, like the text list of an HMI project. `source: 'hmi'` = HMI system alarm (not a PLC bit).
export const ALARM_DEFS = [
  { tag: 'SYS_PLC_STOP', source: 'hmi', cls: 'fault', text: 'PLC i STOP – programmet kører ikke', action: 'Se fejlen med linjenummer i programvisningen, og genstart PLC\'en.' },
  { tag: 'ALM_EStop', cls: 'fault', text: 'Nødstop aktiveret', action: 'Find årsagen, og frigør nødstoppet. Tryk derefter Reset og Start.' },
  ...[1, 2, 3].map((k) => ({
    tag: `ALM_DivFault${k}`, cls: 'fault', text: `Klap ${k} sidder fast – gate ${k} ude af drift`,
    action: `Klappen nåede ikke sit endestop. Kufferter til gate ${k} går til problemstationen. Frigør klappen, og tryk Reset.`,
  })),
  { tag: 'ALM_Queue_Main', cls: 'warning', text: 'Hovedbånd holdt i over 15 s af en fuld gate', action: 'Tjek gate-båndene, og få læsseren ved den fulde gate til at tømme båndet.' },
  ...[1, 2, 3].map((k) => ({
    tag: `ALM_Queue_G${k}`, cls: 'warning', text: `Gate-bånd ${k} fuldt i over 30 s`,
    action: `Læsseren ved gate ${k} er bagud eller stoppet. Bliver det ved, holder hovedbåndet stille.`,
  })),
  { tag: 'ALM_InvalidDest', cls: 'warning', text: 'Kuffert uden gyldig destination sendt til problemstation', action: 'Mærket kunne ikke læses, eller flyet er ukendt. Kufferten kodes manuelt på problemstationen.' },
];

export const STATE_TEXT = {
  'active-unack': 'Aktiv – ukvitteret',
  'active-ack': 'Aktiv – kvitteret',
  'cleared-unack': 'Gået – ukvitteret',
  cleared: 'Gået – kvitteret',
};

export function stateOf(a) {
  if (a.went === null) return a.acked ? 'active-ack' : 'active-unack';
  return a.acked ? 'cleared' : 'cleared-unack';
}

export function createAlarmLog({ defs = ALARM_DEFS, maxHistory = 50 } = {}) {
  let seq = 0;
  const open = new Map(); // tag -> alarm still in the alarm list
  const history = []; // finished alarms (cleared and acknowledged), newest first
  const log = { version: 0, history };

  const changed = () => { log.version++; };
  const finish = (a) => {
    open.delete(a.tag);
    history.unshift(a);
    if (history.length > maxHistory) history.length = maxHistory;
  };

  // read(tag) -> boolean. Call once per HMI update cycle. `now` is a time stamp in ms.
  log.update = (read, now) => {
    for (const def of defs) {
      const on = !!read(def.tag);
      const a = open.get(def.tag);
      if (on && !a) {
        open.set(def.tag, { id: ++seq, tag: def.tag, cls: def.cls, text: def.text, action: def.action, came: now, went: null, acked: false, ackedAt: null, count: 1 });
        changed();
      } else if (on && a && a.went !== null) {
        // Came back before it was acknowledged: same list entry, active and unacknowledged again.
        Object.assign(a, { came: now, went: null, acked: false, ackedAt: null, count: a.count + 1 });
        changed();
      } else if (!on && a && a.went === null) {
        a.went = now;
        if (a.acked) finish(a);
        changed();
      }
    }
  };

  log.ack = (id, now) => {
    for (const a of open.values()) {
      if (a.id !== id || a.acked) continue;
      a.acked = true;
      a.ackedAt = now;
      if (a.went !== null) finish(a);
      changed();
    }
  };

  log.ackAll = (now) => {
    for (const a of [...open.values()]) log.ack(a.id, now);
  };

  // The alarm list: faults before warnings, newest first.
  log.entries = () => [...open.values()].sort((x, y) => (x.cls === y.cls ? y.came - x.came : x.cls === 'fault' ? -1 : 1));

  log.counts = () => {
    const list = [...open.values()];
    return {
      total: list.length,
      active: list.filter((a) => a.went === null).length,
      unack: list.filter((a) => !a.acked).length,
      faults: list.filter((a) => a.cls === 'fault').length,
    };
  };

  return log;
}
