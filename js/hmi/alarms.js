// Alarm list and status-bar banner. Shows the alarm log (alarmlog.js) and lets the operator acknowledge alarms.
// Only sets state classes (fault, warning, unack, cleared); the colours and the flashing live in css/hmi.css.

import { stateOf, STATE_TEXT } from './alarmlog.js';

const CLASS_TEXT = { fault: 'Fejl', warning: 'Advarsel' };

const pad = (n) => String(n).padStart(2, '0');
export const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

export function createAlarmView({ root, banner, log, now = () => Date.now() }) {
  const body = root.querySelector('#alarm-body');
  const ackAllBtn = root.querySelector('#alarm-ack-all');
  const countEl = root.querySelector('#alarm-count');
  const historyEl = root.querySelector('#alarm-history');
  const historyCount = root.querySelector('#alarm-history-count');
  let shown = -1;

  ackAllBtn.addEventListener('click', () => { log.ackAll(now()); render(); });
  banner.addEventListener('click', () => {
    root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const first = body.querySelector('button');
    (first || ackAllBtn).focus({ preventScroll: true });
  });

  function row(a, withAck) {
    const state = stateOf(a);
    const cls = [a.cls, state.endsWith('unack') ? 'unack' : '', a.went !== null ? 'cleared' : ''].filter(Boolean).join(' ');
    const ackCell = withAck
      ? h('td', {}, a.acked ? '' : h('button', { type: 'button', class: 'secondary ack', 'aria-label': `Kvittér: ${a.text}`, onclick: () => { log.ack(a.id, now()); render(); } }, 'Kvittér'))
      : h('td', {}, a.ackedAt ? clock(a.ackedAt) : '');
    return h('tr', { class: cls },
      h('td', { class: 'time' }, clock(a.came)),
      h('td', { class: 'time' }, a.went !== null ? clock(a.went) : '–'),
      h('td', {}, h('span', { class: 'alarm-class' }, CLASS_TEXT[a.cls])),
      h('td', { class: 'alarm-text' },
        h('strong', {}, a.text), a.count > 1 ? h('span', { class: 'repeat', title: 'Kommet igen før kvittering' }, ` ×${a.count}`) : null,
        h('small', {}, a.action),
        h('code', { class: 'alarm-tag' }, a.tag)),
      h('td', { class: 'state' }, STATE_TEXT[state]),
      ackCell);
  }

  const head = (last) => h('thead', {}, h('tr', {},
    ...['Kom', 'Gik', 'Klasse', 'Alarm', 'Tilstand', last].map((t) => h('th', { scope: 'col' }, t))));

  function render() {
    shown = log.version;
    const list = log.entries();
    const c = log.counts();

    body.replaceChildren(list.length
      ? h('table', { class: 'alarm-table' }, head(''), h('tbody', {}, ...list.map((a) => row(a, true))))
      : h('p', { class: 'placeholder' }, 'Ingen alarmer. Anlægget kører normalt.'));
    ackAllBtn.disabled = c.unack === 0;
    countEl.textContent = list.length ? `${c.active} aktive · ${c.unack} ukvitterede` : '';

    historyCount.textContent = String(log.history.length);
    historyEl.replaceChildren(log.history.length
      ? h('table', { class: 'alarm-table' }, head('Kvitteret'), h('tbody', {}, ...log.history.map((a) => row(a, false))))
      : h('p', { class: 'placeholder' }, 'Ingen afsluttede alarmer endnu.'));

    // Banner: the most important alarm that still needs the operator (unacknowledged first).
    const top = list.find((a) => !a.acked) || list[0];
    banner.hidden = !top;
    if (top) {
      banner.className = ['alarm-banner', top.cls, top.acked ? '' : 'unack'].filter(Boolean).join(' ');
      banner.textContent = `${c.total} ${c.total === 1 ? 'alarm' : 'alarmer'} · ${c.unack} ukvitteret – ${top.text}`;
    }
  }

  return {
    // Called from the HMI update cycle. Only redraws when something changed, so focus on the buttons survives.
    refresh() { if (log.version !== shown) render(); },
  };
}
