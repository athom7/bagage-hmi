// Shared test setup: plant + I/O image + scan cycle running plc/program.st, stepped in simulated time.
import { readFileSync } from 'node:fs';
import { Plant } from '../js/plant/plant.js';
import { createImage, TAG_BY_NAME } from '../js/io/tags.js';
import { readInputs, writeOutputs } from '../js/io/io.js';
import { Scan } from '../js/plc/scan.js';
import { compile } from '../js/plc/st/interpreter.js';
import { GAP } from '../js/plant/layout.js';

export const PROGRAM_SOURCE = readFileSync(new URL('../plc/program.st', import.meta.url), 'utf8');

export const compileSource = (source = PROGRAM_SOURCE) => compile(source, { tags: TAG_BY_NAME });

// `started: true` presses Start once, like an operator would.
export function createSystem({ seed = 7, source = PROGRAM_SOURCE, started = true } = {}) {
  const plant = new Plant({ seed });
  const image = createImage();
  const program = compileSource(source);
  const scan = new Scan({ plant, image, program, readInputs, writeOutputs, periodMs: 100 });
  const sys = { plant, image, scan, program };
  if (started) {
    plant.pressButton('start');
    simulate(sys, 0.6);
  }
  return sys;
}

// Advance simulated time: the plant steps in 20 ms increments, the PLC scans every 100 ms.
export function simulate(sys, seconds, onStep = () => {}) {
  const steps = Math.round(seconds / 0.02);
  for (let i = 0; i < steps; i++) {
    sys.plant.step(0.02);
    if (i % 5 === 4) sys.scan.runOnce();
    onStep();
  }
}

// Returns a description of the first overlap found, or null.
export function findOverlap(plant) {
  for (const belt of Object.values(plant.belts)) {
    const b = belt.bags;
    for (let i = 1; i < b.length; i++) {
      const gap = b[i - 1].pos - b[i].pos - (b[i - 1].len + b[i].len) / 2;
      if (gap < GAP - 0.5) return `${belt.def.id}: ${b[i - 1].id} and ${b[i].id} overlap (gap ${gap.toFixed(1)})`;
    }
  }
  return null;
}
