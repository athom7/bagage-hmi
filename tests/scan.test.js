import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scan } from '../js/plc/scan.js';
import { compile } from '../js/plc/st/interpreter.js';
import { TAG_BY_NAME, createImage } from '../js/io/tags.js';

// A scan with spy hooks, to check the order read -> run -> write and what the program sees.
function makeScan(source) {
  const calls = [];
  const image = createImage();
  const field = { sensor: false, motor: null };
  const program = compile(source, { tags: TAG_BY_NAME });
  const original = program.execute.bind(program);
  program.execute = (img, ctx) => { calls.push('execute'); return original(img, ctx); };
  const scan = new Scan({
    plant: field,
    image,
    program,
    readInputs: (f, img) => { calls.push('read'); img.I.I_Start = f.sensor; },
    writeOutputs: (img, f) => { calls.push('write'); f.motor = img.Q.Q_M_Main; },
    periodMs: 100,
  });
  return { scan, calls, image, field };
}

const SRC = (body) => `PROGRAM T\nVAR\n n : INT;\nEND_VAR\n${body}\nEND_PROGRAM`;

test('every scan runs read, execute, write in that order', () => {
  const t = makeScan(SRC('Q_M_Main := I_Start;'));
  t.scan.runOnce();
  t.scan.runOnce();
  assert.deepEqual(t.calls, ['read', 'execute', 'write', 'read', 'execute', 'write']);
  assert.equal(t.scan.count, 2);
});

test('outputs only reach the field after the whole program has run', () => {
  const t = makeScan(SRC('Q_M_Main := TRUE;\nn := 1;'));
  let seenByField = 'untouched';
  t.scan.writeOutputs = (img, f) => { seenByField = img.Q.Q_M_Main; };
  t.field.motor = 'never written during execute';
  t.scan.runOnce();
  assert.equal(seenByField, true);
});

test('the program sees the input state from the start of the scan', () => {
  const t = makeScan(SRC('Q_M_Main := I_Start;\nQ_M_G1 := I_Start;'));
  t.field.sensor = true;
  t.scan.runOnce();
  assert.equal(t.field.motor, true);
  t.field.sensor = false; // changes in the field between scans are only seen by the next scan
  assert.equal(t.image.I.I_Start, true);
  t.scan.runOnce();
  assert.equal(t.image.I.I_Start, false);
});

test('outputs keep their value between scans unless the program writes them', () => {
  const t = makeScan(SRC('IF I_Start THEN\n Q_M_Main := TRUE;\nEND_IF;'));
  t.field.sensor = true;
  t.scan.runOnce();
  t.field.sensor = false;
  t.scan.runOnce();
  assert.equal(t.image.Q.Q_M_Main, true, 'a coil that is only set stays set');
});

test('a runtime error sends the CPU to STOP, clears every output and stops scanning', () => {
  const t = makeScan(SRC('Q_M_Main := TRUE;\nIF I_Start THEN\n n := 1 / (n - n);\nEND_IF;'));
  t.scan.runOnce();
  assert.equal(t.scan.state, 'RUN');
  assert.equal(t.field.motor, true);
  t.field.sensor = true;
  t.scan.runOnce();
  assert.equal(t.scan.state, 'STOP');
  assert.equal(t.scan.error.line, 7);
  assert.equal(t.field.motor, false, 'outputs are FALSE after the error');
  const count = t.scan.count;
  t.scan.runOnce();
  assert.equal(t.scan.count, count, 'a stopped CPU does not scan');
});

test('cold restart with a new program returns the CPU to RUN', () => {
  const t = makeScan(SRC('n := 1 / (n - n);'));
  t.scan.runOnce();
  assert.equal(t.scan.state, 'STOP');
  t.scan.coldStart(compile(SRC('Q_M_Main := TRUE;'), { tags: TAG_BY_NAME }));
  assert.equal(t.scan.state, 'RUN');
  assert.equal(t.scan.error, null);
  t.scan.runOnce();
  assert.equal(t.field.motor, true);
});

test('a program that does not compile puts the CPU in STOP with the error and line', () => {
  const t = makeScan(SRC('Q_M_Main := TRUE;'));
  t.scan.stopWithError(new Error('Linje 3: noget gik galt'));
  assert.equal(t.scan.state, 'STOP');
  assert.match(t.scan.error.message, /Linje 3/);
});
