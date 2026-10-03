// Start-up: wires plant, I/O image, PLC scan and HMI together and starts the two loops.
//   - plant physics + drawing: requestAnimationFrame (smooth motion)
//   - PLC scan cycle: every 100 ms (setInterval), independent of the frame rate

import { Plant } from './plant/plant.js';
import { createImage } from './io/tags.js';
import { readInputs, writeOutputs } from './io/io.js';
import { Scan } from './plc/scan.js';
import { createStubProgram } from './plc/stub-logic.js'; // TEMP phase 1 – replaced by the ST interpreter in phase 2
import { createRenderer } from './hmi/render.js';
import { createInfoPanel } from './hmi/infopanel.js';
import { setupControls } from './hmi/controls.js';

const params = new URLSearchParams(location.search);
const speed = Math.min(10, Math.max(0.25, Number(params.get('speed')) || 1)); // ?speed=4 runs the simulation faster

const plant = new Plant();
const image = createImage();
const scan = new Scan({ plant, image, program: createStubProgram(), readInputs, writeOutputs, periodMs: 100 });

const svg = document.getElementById('plant');
const renderer = createRenderer(svg, plant);
const panel = createInfoPanel({ body: document.getElementById('info-body'), actions: document.getElementById('info-actions'), plant, image });
setupControls({
  svg, plant, panel,
  onReset() {
    plant.reset();
    for (const k of Object.keys(image.Q)) image.Q[k] = false;
    scan.program = createStubProgram();
  },
});

const statusEl = {
  plc: document.getElementById('plc-state'),
  count: document.getElementById('scan-count'),
  exec: document.getElementById('scan-exec'),
  lamp: document.getElementById('lamp-run'),
  checkedIn: document.getElementById('st-checkedin'),
  onPlant: document.getElementById('st-onplant'),
  delivered: document.getElementById('st-delivered'),
  rejected: document.getElementById('st-rejected'),
};

function updateStatus() {
  statusEl.plc.textContent = scan.state;
  statusEl.plc.className = scan.state === 'RUN' ? 'run' : 'stop';
  statusEl.count.textContent = scan.count;
  statusEl.exec.textContent = scan.execMs.toFixed(2);
  statusEl.lamp.className = plant.lamps.run ? 'lamp on' : 'lamp';
  const s = plant.stats;
  statusEl.checkedIn.textContent = s.checkedIn;
  statusEl.onPlant.textContent = [...plant.allBags()].length;
  statusEl.delivered.textContent = s.delivered[1] + s.delivered[2] + s.delivered[3];
  statusEl.rejected.textContent = s.rejected;
}

let last = performance.now();
let sinceUi = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  plant.step(dt * speed);
  renderer.update(panel.selection);
  sinceUi += dt;
  if (sinceUi > 0.2) {
    sinceUi = 0;
    updateStatus();
    panel.refresh();
  }
  requestAnimationFrame(frame);
}

scan.start(speed);
requestAnimationFrame(frame);

// Debug handle for the browser console (and the smoke test): window.bagageHmi.plant etc.
window.bagageHmi = { plant, image, scan };
