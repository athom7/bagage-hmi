// Rules from CLAUDE.md that are easy to break by accident: no colours in JavaScript, both themes complete,
// and every component and every ST network has its Danish explanation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BELTS, SENSORS, DIVERTERS, COUNTERS, ATR, REJECT } from '../js/plant/layout.js';
import { COMPONENTS } from '../js/hmi/components.js';
import { findNetworkLines } from '../js/hmi/stview.js';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

function jsFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('no colour values in JavaScript: colours belong to the CSS themes', () => {
  const colour = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_])|\brgba?\(|\bhsla?\(/;
  const styleProp = /['"](fill|stroke|color|background)['"]\s*:|\.style\.(fill|stroke|color|background)/;
  for (const f of jsFiles('js')) {
    read(f).split('\n').forEach((line, i) => {
      assert.ok(!colour.test(line), `${f}:${i + 1} has a colour value: ${line.trim()}`);
      assert.ok(!styleProp.test(line), `${f}:${i + 1} sets a colour property: ${line.trim()}`);
    });
  }
});

test('both themes define every colour token the stylesheet uses', () => {
  const css = read('css/hmi.css');
  const block = (selector) => {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `missing ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  };
  const defined = (text) => new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const operator = defined(block(':root[data-theme="operator"] {'));
  const showcase = defined(block(':root[data-theme="showcase"] {'));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const t of used) {
    assert.ok(operator.has(t), `operator theme is missing ${t}`);
    assert.ok(showcase.has(t), `showcase theme is missing ${t}`);
  }
});

test('every physical component has a Danish real-world explanation (explainDa)', () => {
  const all = [...Object.values(BELTS), ...SENSORS, ...DIVERTERS, ...Object.values(COUNTERS), ATR, REJECT];
  for (const c of all) {
    assert.equal(typeof c.explainDa, 'string', `${c.id || c.comp} has no explainDa`);
    assert.ok(c.explainDa.length > 40, `${c.id || c.comp}: explainDa is too short`);
  }
  for (const [id, c] of Object.entries(COMPONENTS)) assert.ok(c.explainDa, `${id} shows no explanation in the info panel`);
});

test('every network in program.st has a Danish explanation, and every explanation has its network', () => {
  const lines = read('plc/program.st').split('\n');
  const networks = JSON.parse(read('plc/networks.da.json'));
  const headers = lines.filter((l) => /^\/\/ \d+\. /.test(l.trim())).map((l) => l.trim().slice(3));
  assert.ok(headers.length >= 5);
  assert.deepEqual(networks.map((n) => n.anchor), headers, 'one explanation per network, in program order');
  findNetworkLines(lines, networks).forEach((idx, k) => assert.ok(idx >= 0, `anchor not found: ${networks[k].anchor}`));
  for (const n of networks) {
    assert.ok(n.title && n.explain && n.explain.length > 80, `${n.anchor}: title and explanation required`);
    assert.ok(!/[A-Za-z]+_[A-Za-z]+\s*:=/.test(n.explain), 'explanations are prose, not ST code');
  }
});
