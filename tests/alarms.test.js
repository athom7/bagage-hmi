// Alarm bits in program.st: when they come, when they go, and that a jammed diverter does not break tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSystem, simulate } from './helpers.js';

const FAULTS = ['ALM_EStop', 'ALM_DivFault1', 'ALM_DivFault2', 'ALM_DivFault3'];
const QUEUES = ['ALM_Queue_Main', 'ALM_Queue_G1', 'ALM_Queue_G2', 'ALM_Queue_G3'];

const alarm = (sys, name) => sys.program.getValue(name);

// Runs the simulation and remembers every bag, so their final status can be checked after they have left the plant.
function simulateTracked(sys, seconds, bags = new Map(), onStep = () => {}) {
  simulate(sys, seconds, () => {
    for (const b of sys.plant.allBags()) bags.set(b.id, b);
    onStep();
  });
  return bags;
}

// Where a finished bag ended: 'G1'..'G3' or 'REJ'.
const endOf = (bag) => bag.history[bag.history.length - 1];

test('normal operation at 20 bags/min raises no faults and no queue alarms, only invalid-tag warnings', () => {
  const sys = createSystem({ seed: 3 });
  sys.plant.autoRate = 20;
  const came = new Set();
  let invalidCount = 0;
  let prevInvalid = false;
  simulate(sys, 600, () => {
    for (const a of [...FAULTS, ...QUEUES]) if (alarm(sys, a)) came.add(a);
    const inv = alarm(sys, 'ALM_InvalidDest');
    if (inv && !prevInvalid) invalidCount++;
    prevInvalid = inv;
  });
  assert.deepEqual([...came], [], 'no fault or queue alarm in normal operation');
  assert.ok(invalidCount > 5, `invalid destinations are reported as warnings (got ${invalidCount})`);
  assert.equal(sys.image.Q.Q_Lamp_Fault, false);
});

test('invalid destination warning comes when the tag is read and goes by itself after 5 s', () => {
  const sys = createSystem({ seed: 3 });
  sys.plant.autoRate = 20;
  let cameAt = null;
  let wentAt = null;
  let t = 0;
  simulate(sys, 200, () => {
    t += 0.02;
    const inv = alarm(sys, 'ALM_InvalidDest');
    if (inv && cameAt === null) cameAt = t;
    if (!inv && cameAt !== null && wentAt === null) wentAt = t;
  });
  assert.ok(cameAt !== null && wentAt !== null);
  const held = wentAt - cameAt;
  assert.ok(held >= 4.9 && held <= 7, `warning stays visible for about 5 s (was ${held.toFixed(1)} s)`);
});

test('emergency stop alarm stays active after release until Reset, and lights the fault lamp', () => {
  const sys = createSystem();
  assert.equal(alarm(sys, 'ALM_EStop'), false);
  sys.plant.setEmergencyStop(true);
  simulate(sys, 0.3);
  assert.equal(alarm(sys, 'ALM_EStop'), true);
  assert.equal(sys.image.Q.Q_Lamp_Fault, true);
  sys.plant.setEmergencyStop(false);
  simulate(sys, 1);
  assert.equal(alarm(sys, 'ALM_EStop'), true, 'releasing the button is not enough');
  sys.plant.pressButton('reset');
  simulate(sys, 0.6);
  assert.equal(alarm(sys, 'ALM_EStop'), false);
  assert.equal(sys.image.Q.Q_Lamp_Fault, false);
});

for (const d of [1, 2, 3]) {
  test(`jammed diverter ${d}: fault is latched, its bags go to the problem station, every other bag is still sorted correctly`, () => {
    const sys = createSystem({ seed: 11 });
    sys.plant.autoRate = 20;
    sys.plant.setArmJammed(d, true);
    const bags = simulateTracked(sys, 300);

    assert.equal(alarm(sys, `ALM_DivFault${d}`), true);
    for (const other of [1, 2, 3].filter((k) => k !== d)) assert.equal(alarm(sys, `ALM_DivFault${other}`), false);
    assert.equal(sys.image.Q.Q_Lamp_Fault, true);
    assert.equal(sys.program.getValue('M_State'), 1, 'degraded operation: the plant keeps running');
    assert.equal(sys.image.Q[`Q_Div${d}`], false, 'a diverter in fault is not commanded');

    const done = [...bags.values()].filter((b) => b.status !== 'onbelt');
    assert.ok(done.length > 50);
    for (const b of done) {
      const expected = b.gate === 0 || b.gate === d ? 'REJ' : `G${b.gate}`;
      assert.equal(endOf(b), expected, `bag ${b.id} for gate ${b.gate} ended at ${endOf(b)}`);
    }
    assert.equal(sys.plant.stats.delivered[d], 0);
  });
}

test('after the diverter is freed, Reset clears the fault and the gate sorts again', () => {
  const sys = createSystem({ seed: 11 });
  sys.plant.autoRate = 20;
  sys.plant.setArmJammed(2, true);
  simulate(sys, 60);
  assert.equal(alarm(sys, 'ALM_DivFault2'), true);

  sys.plant.setArmJammed(2, false);
  simulate(sys, 5);
  assert.equal(alarm(sys, 'ALM_DivFault2'), true, 'a fault stays latched until Reset');
  sys.plant.pressButton('reset');
  simulate(sys, 0.6);
  assert.equal(alarm(sys, 'ALM_DivFault2'), false);
  assert.equal(sys.image.Q.Q_Lamp_Fault, false);

  const before = sys.plant.stats.delivered[2];
  simulate(sys, 120);
  assert.ok(sys.plant.stats.delivered[2] > before + 5, 'gate 2 receives bags again');
  assert.equal(alarm(sys, 'ALM_DivFault2'), false);
});

test('Reset while the diverter is still jammed: the fault comes back with the next bag, and tracking still holds', () => {
  // Every Reset lets one more bag find the jammed arm, so this repeats the fault-and-repair many times.
  // Without the tracking repair in program.st, dozens of bags end at the wrong gate here.
  const sys = createSystem({ seed: 11 });
  sys.plant.autoRate = 30;
  sys.plant.setArmJammed(1, true);
  const bags = new Map();
  let faults = 0;
  let prev = false;
  let cleared = false;
  for (let k = 0; k < 20; k++) {
    simulateTracked(sys, 15, bags, () => {
      const v = alarm(sys, 'ALM_DivFault1');
      if (v && !prev) faults++;
      if (!v && prev) cleared = true;
      prev = v;
    });
    sys.plant.pressButton('reset');
  }
  assert.ok(cleared, 'Reset clears the bit while the arm is not commanded');
  assert.ok(faults >= 10, `the fault comes back with the next bag for gate 1 (came ${faults} times)`);
  for (const b of bags.values()) {
    if (b.status === 'onbelt') continue;
    const expected = b.gate === 0 || b.gate === 1 ? 'REJ' : `G${b.gate}`;
    assert.equal(endOf(b), expected, `bag ${b.id} for gate ${b.gate} ended at ${endOf(b)}`);
  }
});

test('a gate whose loader stops raises a gate queue alarm and a main belt queue alarm, both clear when it is emptied', () => {
  const sys = createSystem({ seed: 4 });
  sys.plant.autoRate = 30;
  sys.plant.setLoaderActive(2, false);
  const came = new Set();
  simulate(sys, 150, () => { for (const a of QUEUES) if (alarm(sys, a)) came.add(a); });
  assert.ok(came.has('ALM_Queue_G2'), 'gate 2 queue alarm');
  assert.ok(came.has('ALM_Queue_Main'), 'main belt held by the interlock');
  for (const a of FAULTS) assert.equal(alarm(sys, a), false, `${a}: a queue is a warning, not a fault`);

  sys.plant.setLoaderActive(2, true);
  sys.plant.autoRate = 0;
  simulate(sys, 150);
  for (const a of QUEUES) assert.equal(alarm(sys, a), false, `${a} goes by itself when the queue is gone`);
});
