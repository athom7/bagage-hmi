// SVG rendering of the plant. Reads plant state, never writes to it.

import { BELTS, SENSORS, ATR, DIVERTERS, COUNTERS, pointAt } from '../plant/layout.js';
import { PLACE_NAMES, gateFlights } from './components.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent = null, text = null) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const pathPoints = (belt) => belt.path.map((p) => p.join(',')).join(' ');
const GATE_Y = 428;

export function createRenderer(svg, plant) {
  svg.textContent = '';
  const refs = { belts: {}, sensors: {}, arms: {}, bags: new Map(), counterText: {}, gateText: {}, rejText: null, atr: null };

  const layerBelts = el('g', {}, svg);
  const layerStations = el('g', {}, svg);
  const layerSensors = el('g', {}, svg);
  const layerBags = el('g', {}, svg);
  const layerArms = el('g', {}, svg); // arms are drawn above bags

  // --- belts ---
  for (const belt of Object.values(BELTS)) {
    const g = el('g', { 'data-comp': belt.id, class: 'comp belt' }, layerBelts);
    el('title', {}, g, `${belt.name}: klik for tilstand`);
    el('polyline', { points: pathPoints(belt), class: 'belt-edge' }, g);
    el('polyline', { points: pathPoints(belt), class: 'belt-body' }, g);
    el('polyline', { points: pathPoints(belt), class: 'belt-flow' }, g);
    const first = belt.segs[0];
    const label = belt.id.startsWith('G') ? { x: first.x1 + 24, y: first.y1 + 60 } : belt.id === 'MAIN' ? { x: 345, y: 232 } : { x: 80, y: first.y1 - 24 };
    el('text', { x: label.x, y: label.y, class: 'label' }, g, belt.name);
    refs.belts[belt.id] = g;
  }

  // --- counters ---
  for (const [beltId, c] of Object.entries(COUNTERS)) {
    const g = el('g', { 'data-comp': c.comp, class: 'comp counter' }, layerStations);
    el('title', {}, g, `${c.name}: klik for tilstand`);
    el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 4, class: 'station' }, g);
    el('text', { x: c.x + c.w / 2, y: c.y + 19, class: 'label title counter-title center' }, g, c.name.toUpperCase());
    refs.counterText[beltId] = el('text', { x: c.x + c.w / 2, y: c.y + 38, class: 'label center dim' }, g, 'Kø: 0');
    const btn = el('g', { 'data-action': 'spawn', 'data-counter': beltId, class: 'svg-button', role: 'button', tabindex: 0, 'aria-label': `Ny kuffert ved ${c.name}` }, layerStations);
    el('rect', { x: c.x, y: c.y + c.h + 6, width: c.w, height: 20, rx: 4 }, btn);
    el('text', { x: c.x + c.w / 2, y: c.y + c.h + 20, class: 'center' }, btn, '+ Kuffert');
  }

  // --- gates ---
  for (const dv of DIVERTERS) {
    const g = el('g', { 'data-comp': 'G' + dv.id, class: 'comp gatebox' }, layerStations);
    el('title', {}, g, `Gate ${dv.id}: klik for tilstand`);
    el('rect', { x: dv.x - 80, y: GATE_Y, width: 160, height: 66, rx: 5, class: 'station' }, g);
    el('text', { x: dv.x, y: GATE_Y + 17, class: 'gate-title center' }, g, `GATE ${dv.id}`);
    gateFlights(dv.id).forEach((f, i) => el('text', { x: dv.x, y: GATE_Y + 32 + i * 13, class: 'label small center dim' }, g, `${f.code} ${f.dest}`));
    refs.gateText[dv.id] = el('text', { x: dv.x, y: GATE_Y + 61, class: 'label center' }, g, 'Leveret: 0');
  }

  // --- reject station ---
  {
    const g = el('g', { 'data-comp': 'REJ', class: 'comp rejbox' }, layerStations);
    el('title', {}, g, 'Problemtaske-station: klik for tilstand');
    el('rect', { x: 1114, y: 140, width: 78, height: 80, rx: 5, class: 'station reject' }, g);
    el('text', { x: 1153, y: 163, class: 'label title center' }, g, 'PROBLEM-');
    el('text', { x: 1153, y: 177, class: 'label title center' }, g, 'TASKE');
    refs.rejText = el('text', { x: 1153, y: 205, class: 'gate-title center' }, g, '0');
  }

  // --- photocells ---
  for (const s of SENSORS) {
    const p = pointAt(BELTS[s.belt], s.pos);
    const g = el('g', { 'data-comp': s.id, class: 'comp pe', transform: `translate(${p.x} ${p.y}) rotate(${p.angle + 90})` }, layerSensors);
    el('title', {}, g, `${s.name}: klik for tilstand`);
    el('line', { x1: -19, y1: 0, x2: 19, y2: 0, class: 'beam' }, g);
    el('rect', { x: -4, y: -25, width: 8, height: 8, class: 'pe-head' }, g);
    el('rect', { x: -4, y: 17, width: 8, height: 8, class: 'pe-head' }, g);
    el('rect', { x: -22, y: -26, width: 44, height: 52, class: 'hit' }, g);
    refs.sensors[s.id] = g;
  }

  // --- ATR scanner ---
  {
    const p = pointAt(BELTS[ATR.belt], ATR.pos);
    const g = el('g', { 'data-comp': 'ATR', class: 'comp atr', transform: `translate(${p.x} ${p.y})` }, layerSensors);
    el('title', {}, g, 'ATR-scanner: klik for tilstand');
    el('rect', { x: -9, y: -34, width: 18, height: 68, rx: 3, class: 'atr-body' }, g);
    el('line', { x1: 0, y1: -30, x2: 0, y2: 30, class: 'atr-beam' }, g);
    el('text', { x: 0, y: -40, class: 'label title center' }, g, 'ATR');
    refs.atr = g;
  }

  // --- diverters ---
  for (const dv of DIVERTERS) {
    const g = el('g', { 'data-comp': 'DIV' + dv.id, class: 'comp diverter', transform: `translate(${dv.x - 22} 168)` }, layerArms);
    el('title', {}, g, `Klap ${dv.id}: klik for tilstand`);
    const arm = el('line', { x1: 0, y1: 0, x2: 46, y2: 0, class: 'arm' }, g);
    el('circle', { cx: 0, cy: 0, r: 5, class: 'pivot' }, g);
    el('text', { x: -8, y: -12, class: 'label title' }, g, `KLAP ${dv.id}`);
    refs.arms[dv.id] = arm;
  }

  // --- bags ---
  const bagEl = (bag) => {
    const g = el('g', { 'data-bag': bag.id, class: `bag g${bag.gate}${bag.defect ? ' defect' : ''}` }, layerBags);
    el('title', {}, g, `Kuffert ${bag.id} · ${bag.flight}: klik for detaljer`);
    const body = el('rect', { x: -bag.len / 2, y: -11, width: bag.len, height: 22, rx: 4, class: 'bag-body' }, g);
    const text = el('text', { x: 0, y: 4, class: 'bag-text center' }, g, bag.gate > 0 ? String(bag.gate) : '?');
    return { g, body, text };
  };

  function update(selection) {
    for (const [id, b] of Object.entries(plant.belts)) {
      refs.belts[id].classList.toggle('run', b.motorOn);
    }
    for (const s of SENSORS) refs.sensors[s.id].classList.toggle('blocked', plant.isBlocked(s.id));
    for (const dv of DIVERTERS) {
      const a = plant.diverters[dv.id];
      refs.arms[dv.id].setAttribute('transform', `rotate(${(a.pos * 52).toFixed(1)})`);
      refs.arms[dv.id].parentNode.classList.toggle('ext', plant.armExtended(dv.id));
    }
    refs.atr.classList.toggle('active', plant.time - plant.atr.lastReadAt < 0.35);
    for (const [id, t] of Object.entries(refs.counterText)) {
      const q = plant.counters[id].queued;
      t.textContent = `Kø: ${q}`;
    }
    for (const dv of DIVERTERS) refs.gateText[dv.id].textContent = `Leveret: ${plant.stats.delivered[dv.id]}`;
    refs.rejText.textContent = String(plant.stats.rejected);

    const live = new Set();
    for (const bag of plant.allBags()) {
      live.add(bag.id);
      let r = refs.bags.get(bag.id);
      if (!r) refs.bags.set(bag.id, (r = bagEl(bag)));
      const p = pointAt(BELTS[bag.belt], bag.pos);
      r.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      r.body.setAttribute('transform', `rotate(${p.angle.toFixed(1)})`);
      r.g.classList.toggle('selected', !!selection && selection.type === 'bag' && selection.bag.id === bag.id);
    }
    for (const [id, r] of refs.bags) {
      if (!live.has(id)) {
        r.g.remove();
        refs.bags.delete(id);
      }
    }
    svg.querySelectorAll('.comp.sel').forEach((n) => n.classList.remove('sel'));
    if (selection && selection.type === 'comp') svg.querySelectorAll(`[data-comp="${selection.id}"]`).forEach((n) => n.classList.add('sel'));
  }

  return { update, placeName: (id) => PLACE_NAMES[id] || id };
}
