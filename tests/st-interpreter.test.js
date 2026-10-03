import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../js/plc/st/interpreter.js';
import { tokenize, parseTimeLiteral } from '../js/plc/st/lexer.js';
import { STError } from '../js/plc/st/errors.js';
import { TAG_BY_NAME, createImage } from '../js/io/tags.js';

const tags = TAG_BY_NAME;

// Runs `body` as a program with the given VAR block and returns helpers for stepping it.
function program(vars, body) {
  const src = `PROGRAM T\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`;
  const prog = compile(src, { tags });
  const image = createImage();
  return {
    prog, image,
    scan(n = 1, dtMs = 100) {
      for (let i = 0; i < n; i++) prog.execute(image, { nowMs: 0, dtMs });
    },
  };
}

function errorOf(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail('expected an STError');
}

// ---- lexer ----
test('comments and keywords: (* *) and // comments are skipped, keywords are case-insensitive', () => {
  const toks = tokenize('(* one\ntwo *) if x then // rest\n y := 1; end_if;');
  assert.deepEqual(toks.filter((t) => t.type === 'kw').map((t) => t.value), ['IF', 'THEN', 'END_IF']);
  assert.equal(toks.find((t) => t.value === 'y').line, 3);
});

test('time literals', () => {
  assert.equal(parseTimeLiteral('500ms'), 500);
  assert.equal(parseTimeLiteral('5s'), 5000);
  assert.equal(parseTimeLiteral('1m30s'), 90000);
  assert.equal(parseTimeLiteral('2h'), 7200000);
  assert.equal(parseTimeLiteral('1.5s'), 1500);
  assert.throws(() => parseTimeLiteral('5x'), STError);
});

test('unterminated comment gives an error with the line where it started', () => {
  const e = errorOf(() => tokenize('a\nb (* never closed'));
  assert.equal(e.line, 2);
});

// ---- expressions ----
test('operator precedence: NOT > AND > OR, * before +, comparison before AND', () => {
  const t = program('a : BOOL; b : BOOL; c : BOOL; r1 : BOOL; r2 : BOOL; n : INT; r3 : BOOL;', `
    a := TRUE; b := FALSE; c := TRUE;
    r1 := a OR b AND c;
    r2 := NOT b AND c;
    n := 2 + 3 * 4;
    r3 := n = 14 AND a;`);
  t.scan();
  assert.equal(t.prog.getValue('r1'), true);
  assert.equal(t.prog.getValue('r2'), true);
  assert.equal(t.prog.getValue('n'), 14);
  assert.equal(t.prog.getValue('r3'), true);
});

test('arithmetic: integer division truncates, MOD, unary minus, XOR, comparisons', () => {
  const t = program('x : INT; y : INT; z : INT; u : INT; b : BOOL; c : BOOL;', `
    x := 7 / 2; y := 7 MOD 3; z := -5 + 2; u := 10 - 3 - 2;
    b := TRUE XOR FALSE; c := (3 >= 3) AND (2 <> 3) AND (1 < 2) AND NOT (2 <= 1);`);
  t.scan();
  assert.equal(t.prog.getValue('x'), 3);
  assert.equal(t.prog.getValue('y'), 1);
  assert.equal(t.prog.getValue('z'), -3);
  assert.equal(t.prog.getValue('u'), 5);
  assert.equal(t.prog.getValue('b'), true);
  assert.equal(t.prog.getValue('c'), true);
});

test('INT wraps around like a 16-bit PLC integer', () => {
  const t = program('x : INT := 32767;', 'x := x + 1;');
  t.scan();
  assert.equal(t.prog.getValue('x'), -32768);
});

test('TIME values can be compared and added', () => {
  const t = program('d : TIME := T#1s; ok : BOOL;', 'd := d + T#500ms; ok := d = T#1500ms;');
  t.scan();
  assert.equal(t.prog.getValue('d'), 1500);
  assert.equal(t.prog.getValue('ok'), true);
});

// ---- control flow ----
test('IF / ELSIF / ELSE picks exactly one branch', () => {
  const t = program('n : INT; r : INT;', `
    IF n = 1 THEN r := 10;
    ELSIF n = 2 THEN r := 20;
    ELSE r := 99;
    END_IF;`);
  const results = [];
  for (const n of [1, 2, 3]) {
    t.prog.vars.set('n', n);
    t.scan();
    results.push(t.prog.getValue('r'));
  }
  assert.deepEqual(results, [10, 20, 99]);
});

test('CASE selects by value, supports lists and ELSE', () => {
  const t = program('n : INT; r : INT;', `
    CASE n OF
      1: r := 10;
      2, 3: r := 23;
      -1: r := -10;
    ELSE
      r := 0;
    END_CASE;`);
  const out = [];
  for (const n of [1, 2, 3, -1, 7]) {
    t.prog.vars.set('n', n);
    t.scan();
    out.push(t.prog.getValue('r'));
  }
  assert.deepEqual(out, [10, 23, 23, -10, 0]);
});

// ---- I/O image ----
test('reads inputs and writes outputs through the I/O image; inputs cannot be assigned', () => {
  const t = program('', 'Q_M_Main := I_PE_Merge AND NOT I_PE_D1;');
  t.image.I.I_PE_Merge = true;
  t.scan();
  assert.equal(t.image.Q.Q_M_Main, true);
  t.image.I.I_PE_D1 = true;
  t.scan();
  assert.equal(t.image.Q.Q_M_Main, false);
  const e = errorOf(() => program('', 'I_Start := TRUE;'));
  assert.match(e.rawMessage, /input/);
  assert.equal(e.line, 5);
});

test('variables keep their value between scans (retentive memory)', () => {
  const t = program('n : INT;', 'n := n + 1;');
  t.scan(5);
  assert.equal(t.prog.getValue('n'), 5);
});

// ---- function blocks ----
test('TON: Q after PT of continuous IN, resets when IN drops', () => {
  const t = program('t : TON; q : BOOL;', 't(IN := I_Start, PT := T#500ms); q := t.Q;');
  t.image.I.I_Start = true;
  t.scan(4);
  assert.equal(t.prog.getValue('q'), false, '400 ms is not enough');
  t.scan(1);
  assert.equal(t.prog.getValue('q'), true, '500 ms reached');
  t.image.I.I_Start = false;
  t.scan(1);
  assert.equal(t.prog.getValue('q'), false);
  assert.equal(t.prog.getValue('t.ET'), 0);
  t.image.I.I_Start = true;
  t.scan(3);
  t.image.I.I_Start = false;
  t.scan(1);
  t.image.I.I_Start = true;
  t.scan(4);
  assert.equal(t.prog.getValue('q'), false, 'an interrupted input starts the timer from zero');
});

test('TOF: Q stays TRUE for PT after IN drops', () => {
  const t = program('t : TOF; q : BOOL;', 't(IN := I_Start, PT := T#300ms); q := t.Q;');
  t.image.I.I_Start = true;
  t.scan();
  assert.equal(t.prog.getValue('q'), true);
  t.image.I.I_Start = false;
  t.scan(2);
  assert.equal(t.prog.getValue('q'), true);
  t.scan(1);
  assert.equal(t.prog.getValue('q'), false);
});

test('R_TRIG and F_TRIG give one-scan pulses', () => {
  const t = program('r : R_TRIG; f : F_TRIG; nr : INT; nf : INT;', `
    r(CLK := I_Start); f(CLK := I_Start);
    IF r.Q THEN nr := nr + 1; END_IF;
    IF f.Q THEN nf := nf + 1; END_IF;`);
  const set = (v) => { t.image.I.I_Start = v; t.scan(); };
  set(false); set(true); set(true); set(true); set(false); set(false); set(true); set(false);
  assert.equal(t.prog.getValue('nr'), 2);
  assert.equal(t.prog.getValue('nf'), 2);
});

test('CTU counts rising edges and compares with PV', () => {
  const t = program('c : CTU;', 'c(CU := I_Start, RESET := I_Reset, PV := 3);');
  for (const v of [true, false, true, false, true, true]) { t.image.I.I_Start = v; t.scan(); }
  assert.equal(t.prog.getValue('c.CV'), 3);
  assert.equal(t.prog.getValue('c.Q'), true);
  t.image.I.I_Reset = true;
  t.scan();
  assert.equal(t.prog.getValue('c.CV'), 0);
});

test('FIFO keeps order, reports underflow and overflow', () => {
  const t = program('f : FIFO;', 'f(PUSH := I_Start, IN := 5, POP := I_Stop, RESET := I_Reset);');
  const call = (push, pop, val) => {
    t.prog.vars.set('x', val);
    t.image.I.I_Start = push;
    t.image.I.I_Stop = pop;
    t.scan();
  };
  call(false, true);
  assert.equal(t.prog.getValue('f.UF'), true, 'pop on an empty queue');
  assert.equal(t.prog.getValue('f.OUT'), 0);
  call(true, false);
  call(true, false);
  assert.equal(t.prog.getValue('f.COUNT'), 2);
  call(false, true);
  assert.equal(t.prog.getValue('f.OUT'), 5);
  assert.equal(t.prog.getValue('f.COUNT'), 1);
  for (let i = 0; i < 20; i++) call(true, false);
  assert.equal(t.prog.getValue('f.FULL'), true);
  assert.equal(t.prog.getValue('f.OVF'), true);
  assert.equal(t.prog.getValue('f.COUNT'), 16);
});

test('FIFO delivers values in the order they were pushed', () => {
  const t = program('f : FIFO; v : INT; got : INT;', `
    f(PUSH := I_Start, IN := v, POP := I_Stop);
    got := f.OUT;`);
  const push = (v) => { t.prog.vars.set('v', v); t.image.I.I_Start = true; t.image.I.I_Stop = false; t.scan(); };
  const pop = () => { t.image.I.I_Start = false; t.image.I.I_Stop = true; t.scan(); return t.prog.getValue('got'); };
  push(3); push(0); push(1);
  assert.deepEqual([pop(), pop(), pop()], [3, 0, 1]);
});

test('pop and push in the same call pop the older entry first', () => {
  const t = program('f : FIFO;', 'f(PUSH := TRUE, IN := 7, POP := I_Stop);');
  t.scan();                       // queue: [7]
  t.image.I.I_Stop = true;
  t.scan();                       // pops the old 7, pushes a new 7
  assert.equal(t.prog.getValue('f.OUT'), 7);
  assert.equal(t.prog.getValue('f.COUNT'), 1);
});

// ---- errors with line numbers ----
test('syntax errors report the line', () => {
  const e = errorOf(() => compile('PROGRAM T\nVAR\n x : INT;\nEND_VAR\nx := 1\ny := 2;\nEND_PROGRAM', { tags }));
  assert.ok(e instanceof STError);
  assert.equal(e.line, 5, 'the statement without a semicolon is on line 5');
  assert.match(e.message, /^Linje 5:/);
});

test('a missing semicolon is reported on the line where it is missing, not the next one', () => {
  const e = errorOf(() => compile('PROGRAM T\nVAR x : INT; END_VAR\nx := 1\nx := 2;\nEND_PROGRAM', { tags }));
  assert.equal(e.line, 3);
  assert.match(e.rawMessage, /Mangler ";"/);
});

test('missing END_IF is reported', () => {
  const e = errorOf(() => compile('PROGRAM T\nVAR x : BOOL; END_VAR\nIF x THEN\n x := FALSE;\nEND_PROGRAM', { tags }));
  assert.match(e.rawMessage, /END_IF/);
  assert.equal(e.line, 5, 'points at END_PROGRAM, where the IF should have been closed');
});

test('unknown names, unknown tags and bad types are rejected at compile time', () => {
  assert.match(errorOf(() => program('', 'nothere := 1;')).rawMessage, /Ukendt/);
  assert.match(errorOf(() => program('b : BOOL;', 'b := I_NoSuchTag;')).rawMessage, /Ukendt/);
  assert.match(errorOf(() => program('b : BOOL;', 'b := 5;')).rawMessage, /INT.*BOOL/);
  assert.match(errorOf(() => program('n : INT;', 'n := TRUE AND 3;')).rawMessage, /BOOL/);
  assert.match(errorOf(() => program('n : INT;', 'IF n THEN n := 1; END_IF;')).rawMessage, /BOOL/);
  assert.match(errorOf(() => program('n : INT;', 'n := T#1s;')).rawMessage, /TIME/);
  assert.match(errorOf(() => program('t : TON;', 't(IN := 5, PT := T#1s);')).rawMessage, /BOOL/);
  assert.match(errorOf(() => program('t : TON;', 't(BAD := TRUE);')).rawMessage, /ingen indgang/);
  assert.match(errorOf(() => program('t : TON;', 'Q_M_Main := t.NOPE;')).rawMessage, /feltet/);
  assert.match(errorOf(() => program('n : INT; n : INT;', '')).rawMessage, /to gange/);
  assert.match(errorOf(() => program('x : WIDGET;', '')).rawMessage, /datatype/);
  assert.match(errorOf(() => program('n : INT;', 'CASE n OF 1: n := 2; 1: n := 3; END_CASE;')).rawMessage, /to gange/);
});

test('type errors carry the line number of the faulty statement', () => {
  const e = errorOf(() => program('b : BOOL;', '\n\nb := 5;'));
  assert.equal(e.line, 7);
});

test('division by zero is a runtime error with the line number', () => {
  const t = program('n : INT; d : INT;', 'n := 10 / d;');
  const e = errorOf(() => t.scan());
  assert.equal(e.kind, 'runtime');
  assert.equal(e.line, 5);
});

// ---- cross reference info used by the HMI ----
test('cross reference: which lines write a tag and which read an input', () => {
  const t = program('n : INT;', `
    IF I_Start THEN
      n := 1;
    END_IF;
    Q_M_Main := I_Start AND I_PE_Merge;`);
  const info = t.prog.info;
  const write = info.assigns.find((a) => a.target === 'Q_M_Main');
  assert.equal(write.line, 9);
  assert.deepEqual([...info.reads.get('I_Start')].sort(), [6, 9]);
  const inner = info.assigns.find((a) => a.target === 'n');
  assert.deepEqual(inner.ctx, [6], 'the enclosing IF line is recorded');
});

// ---- the real control program ----
test('plc/program.st compiles and declares what the HMI expects', async () => {
  const { compileSource } = await import('./helpers.js');
  const prog = compileSource();
  assert.equal(prog.name, 'Baggage');
  for (const name of ['M_State', 'M_Run', 'M_MainOk', 'M_Want1', 'M_Want2', 'M_Want3', 'FIFO_1.COUNT']) {
    assert.notEqual(prog.typeOf(name), undefined, `${name} must exist`);
  }
});
