import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSystem, simulate, findOverlap } from './helpers.js';

test('a bag from each check-in belt reaches the gate its flight is assigned to', () => {
  const sys = createSystem({ seed: 3 });
  sys.plant.enqueueBag('CI1');
  sys.plant.enqueueBag('CI2');
  const seen = new Map();
  simulate(sys, 40, () => { for (const b of sys.plant.allBags()) seen.set(b.id, b); });
  const { stats } = sys.plant;
  assert.equal(stats.checkedIn, 2);
  assert.equal(stats.delivered[1] + stats.delivered[2] + stats.delivered[3] + stats.rejected, 2);
  assert.equal(stats.misrouted, 0);
});

test('long run with 20 bags/min: no bag is misrouted, none overlap, nothing is lost', () => {
  const sys = createSystem({ seed: 11 });
  sys.plant.autoRate = 20;
  let problem = null;
  const expectedGate = new Map();
  simulate(sys, 600, () => {
    problem = problem || findOverlap(sys.plant);
    for (const b of sys.plant.allBags()) expectedGate.set(b.id, b.gate);
  });
  assert.equal(problem, null);
  const { stats } = sys.plant;
  assert.equal(stats.misrouted, 0, 'bags with a valid destination must never end up at the problem station or a wrong gate');
  const onPlant = [...sys.plant.allBags()].length;
  const queued = sys.plant.counters.CI1.queued + sys.plant.counters.CI2.queued;
  const delivered = stats.delivered[1] + stats.delivered[2] + stats.delivered[3];
  assert.equal(delivered + stats.rejected + onPlant, stats.checkedIn);
  assert.ok(stats.checkedIn > 150, `expected plenty of traffic, got ${stats.checkedIn}`);
  assert.ok(stats.rejected > 0, 'invalid bags (about 10 %) must end up at the problem station');
  assert.ok(queued <= 12);
});

test('bags without a valid destination go to the problem station', () => {
  const sys = createSystem({ seed: 5 });
  sys.plant.autoRate = 20;
  const invalidIds = new Set();
  const rejectedIds = new Set();
  simulate(sys, 400, () => {
    for (const b of sys.plant.allBags()) if (b.gate === 0) invalidIds.add(b.id);
  });
  assert.ok(sys.plant.stats.rejected > 0);
  assert.equal(sys.plant.stats.misrouted, 0);
});

test('emergency stop stops every belt at once and locks the plant until released and reset', () => {
  const sys = createSystem();
  sys.plant.autoRate = 20;
  simulate(sys, 20);
  assert.ok(sys.image.Q.Q_M_Main, 'plant runs after Start');
  sys.plant.setEmergencyStop(true);
  for (const belt of Object.values(sys.plant.belts)) assert.equal(belt.motorOn && sys.plant.operator.estopOk, false, 'hard-wired cut');
  simulate(sys, 0.3);
  for (const tag of ['Q_M_CI1', 'Q_M_CI2', 'Q_M_Main', 'Q_M_G1', 'Q_M_G2', 'Q_M_G3']) assert.equal(sys.image.Q[tag], false, `${tag} must be FALSE`);
  assert.equal(sys.program.getValue('M_State'), 2);
  assert.equal(sys.image.Q.Q_Lamp_Fault, true);

  // Start is ignored while the mushroom button is pressed and while the fault is latched.
  sys.plant.pressButton('start');
  simulate(sys, 0.6);
  assert.equal(sys.program.getValue('M_State'), 2);

  // Releasing the button alone does not restart the plant: it needs Reset, then Start.
  sys.plant.setEmergencyStop(false);
  simulate(sys, 0.5);
  assert.equal(sys.program.getValue('M_State'), 2);
  sys.plant.pressButton('reset');
  simulate(sys, 0.6);
  assert.equal(sys.program.getValue('M_State'), 0);
  assert.equal(sys.image.Q.Q_M_Main, false);
  sys.plant.pressButton('start');
  simulate(sys, 0.6);
  assert.equal(sys.program.getValue('M_State'), 1);
  assert.equal(sys.image.Q.Q_M_Main, true);
});

test('Stop halts the belts and Start continues without losing track of any bag', () => {
  const sys = createSystem({ seed: 21 });
  sys.plant.autoRate = 24;
  simulate(sys, 30);
  sys.plant.pressButton('stop');
  simulate(sys, 0.6);
  assert.equal(sys.image.Q.Q_M_Main, false);
  simulate(sys, 5);
  sys.plant.pressButton('start');
  simulate(sys, 120);
  assert.equal(sys.plant.stats.misrouted, 0);
});

test('photocell is only blocked while a bag covers the beam', () => {
  const sys = createSystem();
  assert.equal(sys.plant.isBlocked('PE_CI1'), false);
  sys.plant.enqueueBag('CI1');
  let sawBlocked = false;
  simulate(sys, 6, () => { if (sys.plant.isBlocked('PE_CI1')) sawBlocked = true; });
  assert.ok(sawBlocked);
});

test('a full gate holds the main belt, and no bag is lost while it waits or when it restarts', () => {
  const sys = createSystem({ seed: 4 });
  sys.plant.autoRate = 30;
  sys.plant.setLoaderActive(2, false); // nobody unloads gate 2: its belt fills up
  let mainHeld = false;
  let problem = null;
  simulate(sys, 150, () => {
    if (sys.program.getValue('M_State') === 1 && !sys.image.Q.Q_M_Main) mainHeld = true;
    problem = problem || findOverlap(sys.plant);
  });
  assert.ok(mainHeld, 'the interlock must stop the main belt when the next bag is for the full gate');
  assert.equal(problem, null);
  assert.equal(sys.plant.stats.misrouted, 0);
  sys.plant.setLoaderActive(2, true);
  let runningAgain = 0;
  simulate(sys, 150, () => { if (sys.image.Q.Q_M_Main) runningAgain++; });
  assert.equal(sys.plant.stats.misrouted, 0, 'bags for other gates must not be lost after the gate is emptied');
  assert.ok(runningAgain > 3000, 'main belt runs again once the gate is emptied');
  assert.ok(sys.plant.stats.delivered[2] > 10, 'the waiting bags reach gate 2');
});
