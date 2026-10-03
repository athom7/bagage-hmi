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

test('emergency stop de-energises every motor and diverter within one scan', () => {
  const sys = createSystem();
  sys.plant.autoRate = 20;
  simulate(sys, 20);
  assert.ok(sys.image.Q.Q_M_Main);
  sys.plant.operator.estopOk = false;
  sys.scan.runOnce();
  for (const [name, v] of Object.entries(sys.image.Q)) assert.equal(v, false, `${name} must be FALSE`);
  for (const belt of Object.values(sys.plant.belts)) assert.equal(belt.motorOn, false);
});

test('photocell is only blocked while a bag covers the beam', () => {
  const sys = createSystem();
  assert.equal(sys.plant.isBlocked('PE_CI1'), false);
  sys.plant.enqueueBag('CI1');
  let sawBlocked = false;
  simulate(sys, 6, () => { if (sys.plant.isBlocked('PE_CI1')) sawBlocked = true; });
  assert.ok(sawBlocked);
});
