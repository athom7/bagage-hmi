// Info panel: details for a clicked bag or component. Reads plant state and the I/O image, never writes.

import { TAG_BY_NAME, tagValue } from '../io/tags.js';
import { COMPONENTS, PLACE_NAMES } from './components.js';
import { plannedRoute } from '../plant/bag.js';
import { defectText } from '../plant/flights.js';
import { logicHtml } from './stview.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pill = (text, cls) => `<span class="pill ${cls}">${esc(text)}</span>`;
const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;

function tagTable(image, names) {
  const rows = names.map((n) => {
    const t = TAG_BY_NAME[n];
    const v = tagValue(image, n);
    const val = t.type === 'BOOL' ? `<span class="bit ${v ? 'on' : 'off'}">${v ? 'TRUE' : 'FALSE'}</span>` : `<span class="bit">${esc(v)}</span>`;
    return `<tr><td><code>${esc(n)}</code></td><td><code>${esc(t.addr)}</code></td><td>${val}</td><td>${esc(t.desc)}</td></tr>`;
  });
  return `<h3>Signaler</h3><table class="tags"><thead><tr><th>Tag</th><th>Adresse</th><th>Værdi</th><th>Beskrivelse</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const logicSection = (program, tags, intro) => `<h3>Styrende logik</h3><p class="logic-intro">${intro}</p>${logicHtml(program, tags)}`;
const LOGIC_OUT = 'Disse linjer i <code>plc/program.st</code> styrer udgangen (og de variable, de bruger). Værdierne er live.';
const LOGIC_IN = "Dette er et input fra marken. PLC'en styrer det ikke, men læser det i starten af hver scancyklus. Disse linjer bruger signalet:";
const LOGIC_NONE = `<h3>Styrende logik</h3><p class="logic-placeholder">Ingen PLC-styring. Det er en del af processen uden for anlæggets styring.</p>`;

function bagHtml(bag, plant) {
  const planned = plannedRoute(bag);
  const done = new Set(bag.history);
  const steps = planned.map((id) => {
    const current = bag.status === 'onbelt' && bag.belt === id;
    const mark = current ? '●' : done.has(id) ? '✓' : '○';
    const cls = current ? 'now' : done.has(id) ? 'done' : '';
    return `<li class="${cls}"><span class="mark">${mark}</span>${esc(PLACE_NAMES[id])}</li>`;
  });
  const extra = bag.history.filter((id) => !planned.includes(id) && !id.startsWith('G'));
  for (const id of extra) steps.push(`<li class="now warn"><span class="mark">!</span>${esc(PLACE_NAMES[id] || id)} (ikke planlagt)</li>`);

  const where = bag.status === 'delivered' ? `Leveret ved ${PLACE_NAMES[bag.belt]}`
    : bag.status === 'rejected' ? 'På problemtaske-stationen'
    : `${PLACE_NAMES[bag.belt]} (${Math.round((bag.pos / plant.belts[bag.belt].def.length) * 100)} %)`;
  const statusPill = bag.status === 'delivered' ? pill('Leveret', 'ok') : bag.status === 'rejected' ? pill('Afvist', 'warn') : pill('På anlægget', 'blue');
  const t = ((bag.tEnd ?? plant.time) - bag.t0).toFixed(1);

  const alerts = [];
  if (bag.defect) alerts.push(`<p class="alert">${esc(defectText[bag.defect])}. ATR-scanneren giver destination 0, så kufferten sendes forbi alle klapper til problemtaske-stationen.</p>`);
  if (bag.misrouted) alerts.push(`<p class="alert">Afveg fra planlagt rute: kufferten havde en gyldig destination, men blev ikke leveret ved sin gate.</p>`);

  return `
    <h2>Kuffert ${esc(bag.id)} ${statusPill}</h2>
    <dl>
      ${row('Flynummer', esc(bag.flight))}
      ${row('Destination', esc(bag.dest))}
      ${row('Gate', bag.gate > 0 ? `Gate ${bag.gate}` : 'Ingen gyldig')}
      ${row('Vægt', `${bag.weight} kg`)}
      ${row('Bagagemærke', `<code>${esc(bag.tag)}</code>`)}
      ${row('Tjekket ind', esc(PLACE_NAMES[bag.source].replace('Check-in-bånd', 'Skranke')))}
      ${row('Placering', esc(where))}
      ${row('Tid på anlægget', `${t} s`)}
    </dl>
    ${alerts.join('')}
    <h3>Rute</h3>
    <ol class="route">${steps.join('')}</ol>`;
}

function compHtml(id, plant, image, program) {
  const c = COMPONENTS[id];
  const head = (state, cls) => `<h2>${esc(c.name)} ${pill(state, cls)}</h2><p class="desc">${esc(c.desc)}</p>`
    + `<div class="explain"><h3>I en rigtig lufthavn</h3><p>${esc(c.explainDa)}</p></div>`;
  const sensors = (c.sensors && c.sensors.length) ? c.sensors : [];

  switch (c.kind) {
    case 'belt':
    case 'gate': {
      const belt = plant.belts[c.belt];
      const on = belt.motorOn;
      let html = head(on ? 'Kører' : 'Står stille', on ? 'ok' : 'off');
      html += `<dl>
        ${row('Motor-kommando', `<code>${c.motor}</code> = ${tagValue(image, c.motor) ? 'TRUE' : 'FALSE'}`)}
        ${row('Kufferter på båndet', belt.bags.length)}
        ${row('Båndhastighed', `${belt.def.speed} enheder/s`)}
        ${c.kind === 'gate' ? row('Leveret hertil', plant.stats.delivered[c.gate]) : ''}
        ${c.kind === 'gate' ? row('Læsser', plant.gates[c.gate].loaderActive ? 'Aktiv' : 'Pauset') : ''}
      </dl>`;
      return html + tagTable(image, [c.motor, ...sensors]) + logicSection(program, [c.motor], LOGIC_OUT);
    }
    case 'diverter': {
      const a = plant.diverters[c.div];
      const ext = plant.armExtended(c.div);
      const state = ext ? 'Udslået' : a.pos < 0.01 ? 'Indtrukket' : 'Skifter';
      return head(state, ext ? 'blue' : a.pos < 0.01 ? 'off' : 'warn')
        + `<dl>${row('Kommando', `<code>${c.out}</code> = ${tagValue(image, c.out) ? 'TRUE' : 'FALSE'}`)}${row('Armens stilling', `${Math.round(a.pos * 100)} %`)}${row('Gangtid', '0,3 s')}</dl>`
        + tagTable(image, [c.out, ...sensors, `I_PE_D${c.div}`]) + logicSection(program, [c.out], LOGIC_OUT);
    }
    case 'sensor': {
      const blocked = plant.isBlocked(id);
      return head(blocked ? 'Afbrudt' : 'Fri', blocked ? 'warn' : 'off')
        + `<dl>${row('Sidder på', esc(PLACE_NAMES[c.sensor.belt]))}${row('Placering', `${Math.round(c.sensor.pos)} enheder fra båndets start`)}</dl>`
        + tagTable(image, sensors) + logicSection(program, sensors, LOGIC_IN);
    }
    case 'atr': {
      const active = plant.atrActive();
      return head(active ? 'Læser' : 'Klar', active ? 'blue' : 'off')
        + `<dl>${row('Seneste destination', plant.atr.dest > 0 ? `Gate ${plant.atr.dest}` : '0 (ingen gyldig)')}${row('Seneste aflæsning', plant.atr.lastReadAt > 0 ? `${(plant.time - plant.atr.lastReadAt).toFixed(1)} s siden` : '–')}</dl>`
        + tagTable(image, sensors) + logicSection(program, sensors, LOGIC_IN);
    }
    case 'counter': {
      const q = plant.counters[c.belt].queued;
      return head(q > 0 ? `${q} i kø` : 'Ledig', q > 0 ? 'blue' : 'off')
        + `<dl>${row('Kufferter i kø', q)}${row('Tjekket ind i alt (hele anlægget)', plant.stats.checkedIn)}</dl>` + LOGIC_NONE;
    }
    case 'reject': {
      const n = plant.stats.rejected;
      return head(`${n} afvist`, n > 0 ? 'warn' : 'off')
        + `<dl>${row('Afvist i alt', n)}${row('Heraf med gyldig destination', plant.stats.misrouted)}</dl>` + LOGIC_NONE;
    }
    default:
      return '';
  }
}

function overviewHtml(plant) {
  const s = plant.stats;
  const onPlant = [...plant.allBags()].length;
  return `
    <h2>Anlægsoversigt</h2>
    <p class="desc">Klik på en kuffert for at se flynummer, destination, vægt og rute. Klik på et bånd, en fotocelle, en klap eller en gate for at se tilstand og signaler.</p>
    <dl>
      ${row('Tjekket ind', s.checkedIn)}
      ${row('På anlægget nu', onPlant)}
      ${row('Leveret, gate 1 / 2 / 3', `${s.delivered[1]} / ${s.delivered[2]} / ${s.delivered[3]}`)}
      ${row('Problemtaske-station', s.rejected)}
    </dl>`;
}

export function createInfoPanel({ body, actions, plant, image, getProgram = () => null, onSelect = () => {} }) {
  let selection = null;
  let last = '';

  function renderActions() {
    let html = '';
    if (selection && selection.type === 'comp') {
      const c = COMPONENTS[selection.id];
      if (c.kind === 'gate') {
        const on = plant.gates[c.gate].loaderActive;
        html += `<button type="button" data-action="toggle-loader" data-gate="${c.gate}">${on ? 'Pause læsser' : 'Genoptag læsser'}</button>`;
      }
    }
    if (selection) html += `<button type="button" class="secondary" data-action="clear-selection">Luk</button>`;
    actions.innerHTML = html;
  }

  function refresh() {
    let html;
    if (!selection) html = overviewHtml(plant);
    else if (selection.type === 'bag') html = bagHtml(selection.bag, plant);
    else html = compHtml(selection.id, plant, image, getProgram());
    if (html !== last) {
      body.innerHTML = html;
      last = html;
    }
  }

  return {
    get selection() { return selection; },
    select(sel) {
      selection = sel;
      last = '';
      renderActions();
      refresh();
      onSelect(sel);
    },
    refresh,
    refreshActions: renderActions,
  };
}
