// HMI alarm log: ISA-18.2 states, acknowledgement, history, and that every alarm bit in program.st has a text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlarmLog, stateOf, ALARM_DEFS } from '../js/hmi/alarmlog.js';
import { createSystem, simulate, PROGRAM_SOURCE } from './helpers.js';

const DEFS = [
  { tag: 'A_FAULT', cls: 'fault', text: 'fejl', action: '' },
  { tag: 'A_WARN', cls: 'warning', text: 'advarsel', action: '' },
];

// Bits as a plain object; read() is what the HMI would poll.
function setup() {
  const bits = { A_FAULT: false, A_WARN: false };
  const log = createAlarmLog({ defs: DEFS, maxHistory: 3 });
  const poll = (t) => log.update((tag) => bits[tag], t);
  return { bits, log, poll };
}

test('an alarm comes with a time stamp and is active and unacknowledged', () => {
  const { bits, log, poll } = setup();
  poll(1000);
  assert.equal(log.entries().length, 0);
  bits.A_FAULT = true;
  poll(2000);
  const [a] = log.entries();
  assert.equal(a.came, 2000);
  assert.equal(stateOf(a), 'active-unack');
  assert.deepEqual(log.counts(), { total: 1, active: 1, unack: 1, faults: 1 });
});

test('acknowledged first, then gone: the alarm leaves the list and goes to the history', () => {
  const { bits, log, poll } = setup();
  bits.A_FAULT = true;
  poll(1000);
  const id = log.entries()[0].id;
  log.ack(id, 1500);
  assert.equal(stateOf(log.entries()[0]), 'active-ack', 'an acknowledged alarm stays while the bit is TRUE');
  bits.A_FAULT = false;
  poll(3000);
  assert.equal(log.entries().length, 0);
  assert.equal(log.history[0].went, 3000);
  assert.equal(log.history[0].ackedAt, 1500);
  assert.equal(stateOf(log.history[0]), 'cleared');
});

test('gone before it was acknowledged: it stays in the list until the operator acknowledges it', () => {
  const { bits, log, poll } = setup();
  bits.A_WARN = true;
  poll(1000);
  bits.A_WARN = false;
  poll(2000);
  const [a] = log.entries();
  assert.equal(stateOf(a), 'cleared-unack');
  assert.equal(a.went, 2000);
  log.ack(a.id, 2500);
  assert.equal(log.entries().length, 0);
  assert.equal(log.history.length, 1);
});

test('an alarm that comes back before acknowledgement reuses its entry and counts the repeats', () => {
  const { bits, log, poll } = setup();
  for (let k = 0; k < 3; k++) {
    bits.A_WARN = true;
    poll(1000 * k);
    bits.A_WARN = false;
    poll(1000 * k + 500);
  }
  bits.A_WARN = true;
  poll(5000);
  const list = log.entries();
  assert.equal(list.length, 1, 'no flood of identical entries');
  assert.equal(list[0].count, 4);
  assert.equal(stateOf(list[0]), 'active-unack');
  assert.equal(list[0].came, 5000);
});

test('acknowledge all, faults are listed before warnings, and the history is limited', () => {
  const { bits, log, poll } = setup();
  bits.A_WARN = true;
  poll(1000);
  bits.A_FAULT = true;
  poll(2000);
  assert.deepEqual(log.entries().map((a) => a.tag), ['A_FAULT', 'A_WARN']);
  const v = log.version;
  log.ackAll(2500);
  assert.ok(log.version > v, 'a change bumps the version so the view redraws');
  assert.equal(log.counts().unack, 0);

  for (let k = 0; k < 5; k++) {
    bits.A_WARN = false;
    poll(3000 + k * 100);
    log.ackAll(3000 + k * 100);
    bits.A_WARN = true;
    poll(3050 + k * 100);
  }
  assert.ok(log.history.length <= 3);
});

test('polling without a change does not bump the version (the list is not redrawn needlessly)', () => {
  const { bits, log, poll } = setup();
  bits.A_FAULT = true;
  poll(1000);
  const v = log.version;
  poll(1200);
  poll(1400);
  assert.equal(log.version, v);
});

test('every ALM_ bit in program.st has an alarm text, and every PLC alarm text has its bit', () => {
  const declared = [...PROGRAM_SOURCE.matchAll(/^\s*(ALM_\w+)\s*:\s*BOOL/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 9);
  const plcDefs = ALARM_DEFS.filter((d) => d.source !== 'hmi').map((d) => d.tag);
  assert.deepEqual([...plcDefs].sort(), [...declared].sort());
  for (const d of ALARM_DEFS) {
    assert.ok(d.cls === 'fault' || d.cls === 'warning', `${d.tag}: class must be fault or warning`);
    assert.ok(d.text.length > 10 && d.action.length > 20, `${d.tag}: text and operator action required`);
  }
});

test('with the real PLC program: a jammed diverter shows up in the alarm log as a fault', () => {
  const sys = createSystem({ seed: 11 });
  sys.plant.autoRate = 20;
  sys.plant.setArmJammed(3, true);
  const log = createAlarmLog();
  let t = 0;
  simulate(sys, 120, () => {
    t += 20;
    if (t % 200 === 0) log.update((tag) => sys.program.getValue(tag) === true, t); // HMI polls every 200 ms
  });
  const fault = log.entries().find((a) => a.tag === 'ALM_DivFault3');
  assert.ok(fault, 'fault is in the list');
  assert.equal(fault.cls, 'fault');
  assert.equal(stateOf(fault), 'active-unack');
});
