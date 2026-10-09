// Start-up: wires plant, I/O image, PLC scan and HMI together and starts the two loops.
//   - plant physics + drawing: requestAnimationFrame (smooth motion)
//   - PLC scan cycle: every 100 ms (setInterval), independent of the frame rate
// The control logic itself lives in plc/program.st and is interpreted by js/plc/st/.

import { Plant } from './plant/plant.js';
import { createImage, TAG_BY_NAME } from './io/tags.js';
import { readInputs, writeOutputs } from './io/io.js';
import { Scan } from './plc/scan.js';
import { compile } from './plc/st/interpreter.js';
import { createRenderer } from './hmi/render.js';
import { createInfoPanel } from './hmi/infopanel.js';
import { createStView, explainLines } from './hmi/stview.js';
import { logicTagsOf } from './hmi/components.js';
import { setupControls } from './hmi/controls.js';
import { setupTheme } from './hmi/theme.js';
import { createAlarmLog } from './hmi/alarmlog.js';
import { createAlarmView } from './hmi/alarms.js';

const PROGRAM_URL = 'plc/program.st';
const params = new URLSearchParams(location.search);
const speed = Math.min(10, Math.max(0.25, Number(params.get('speed')) || 1)); // ?speed=4 runs the simulation faster

// ---- load the PLC program ----
let originalSource = '';
let loadError = null;
try {
  const res = await fetch(PROGRAM_URL);
  if (!res.ok) throw new Error(`Kunne ikke hente ${PROGRAM_URL} (HTTP ${res.status})`);
  originalSource = await res.text();
} catch (err) {
  loadError = location.protocol === 'file:'
    ? new Error('Siden skal åbnes via en webserver (fx python3 -m http.server), ikke direkte fra filen.')
    : err;
}

const compileSource = (source) => compile(source, { tags: TAG_BY_NAME });
// Stand-in when there is no runnable program: lets the HMI show the source and the error.
const emptyProgram = (source) => ({
  name: '', source, lines: source.split('\n'), symbols: new Map(), info: null,
  execute() {}, getValue() {}, typeOf() {}, fifoContents() { return null; },
});

let currentSource = originalSource;
let program;
let startupError = loadError;
try {
  program = loadError ? emptyProgram('') : compileSource(originalSource);
} catch (err) {
  startupError = err; // a program that does not compile: the CPU stays in STOP
  program = emptyProgram(originalSource);
}

// ---- plant, I/O image, scan ----
const plant = new Plant();
const image = createImage();
const scan = new Scan({ plant, image, program, readInputs, writeOutputs, periodMs: 100 });
if (startupError) scan.stopWithError(startupError);

const sim = {
  paused: false,
  stepOnce() { // one PLC scan = 100 ms of plant time
    plant.step(0.1);
    scan.runOnce();
    refreshUi();
  },
};

// ---- HMI ----
const svg = document.getElementById('plant');
const renderer = createRenderer(svg, plant);

const stview = createStView({
  root: document.getElementById('stview'),
  onApply(source) { // "download" a new program: only accepted if it compiles
    try {
      const p = compileSource(source);
      currentSource = source;
      coldRestart(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message, line: err.line || 0 };
    }
  },
  onRevert() {
    currentSource = originalSource;
    coldRestart(compileSource(originalSource));
  },
});

const panel = createInfoPanel({
  body: document.getElementById('info-body'),
  actions: document.getElementById('info-actions'),
  plant, image,
  getProgram: () => scan.program,
  onSelect(sel) {
    stview.highlight(sel && sel.type === 'comp' && scan.program.info ? explainLines(scan.program, logicTagsOf(sel.id)) : []);
  },
});

// Cold start: clears the line (the tracking queues are empty after a cold start, so the bags on the
// belts would no longer match) and starts a fresh program instance. Then the operator presses Start.
function coldRestart(p) {
  plant.reset();
  scan.coldStart(p);
  stview.setProgram(p);
  plant.pressButton('start');
}

function resetPlant() {
  try {
    coldRestart(compileSource(currentSource));
  } catch (err) {
    scan.stopWithError(err);
    stview.showError(err.message, err.line || 0);
  }
}

setupControls({ svg, plant, panel, sim, onReset: resetPlant });
setupTheme(document.getElementById('theme-toggle'));
document.getElementById('plc-restart').addEventListener('click', () => {
  currentSource = originalSource;
  resetPlant();
  document.getElementById('op-estop').textContent = 'NØDSTOP';
});

stview.setProgram(program);
// Danish explanations per network. Optional: without them the program view just has no "Forklar" buttons.
fetch('plc/networks.da.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((list) => stview.setNetworks(list))
  .catch(() => {});
if (startupError) stview.showError(startupError.message, startupError.line || 0);
else plant.pressButton('start'); // as if the operator pressed Start when the page opened

// ---- alarms ----
// The HMI polls the alarm bits in its own update cycle (like an operator panel polling the PLC) and keeps
// time stamps and acknowledgement itself. SYS_PLC_STOP is an HMI system alarm, not a PLC bit.
const alarmLog = createAlarmLog();
const alarmView = createAlarmView({ root: document.getElementById('alarms'), banner: document.getElementById('alarm-banner'), log: alarmLog });
const readAlarm = (tag) => (tag === 'SYS_PLC_STOP' ? scan.state === 'STOP' : scan.program.getValue(tag) === true);
function updateAlarms() {
  alarmLog.update(readAlarm, Date.now());
  alarmView.refresh();
}

// ---- status bar ----
const el = (id) => document.getElementById(id);
const statusEl = {
  plc: el('plc-state'), count: el('scan-count'), exec: el('scan-exec'), state: el('plant-state'),
  lampRun: el('lamp-run'), lampFault: el('lamp-fault'), error: el('plc-error'), restart: el('plc-restart'),
  checkedIn: el('st-checkedin'), onPlant: el('st-onplant'), delivered: el('st-delivered'), rejected: el('st-rejected'),
};
const STATE_TEXT = { 0: 'Stoppet', 1: 'I drift', 2: 'Nødstop' };
let shownError = null;

function updateStatus() {
  statusEl.plc.textContent = scan.state;
  statusEl.plc.className = scan.state === 'RUN' ? 'running' : 'fault';
  statusEl.count.textContent = scan.count;
  statusEl.exec.textContent = scan.execMs.toFixed(2);
  const st = scan.program.getValue('M_State');
  statusEl.state.textContent = scan.state === 'STOP' ? 'PLC i STOP' : STATE_TEXT[st] || '–';
  statusEl.lampRun.classList.toggle('running', plant.lamps.run);
  statusEl.lampFault.classList.toggle('fault', plant.lamps.fault || scan.state === 'STOP');
  const s = plant.stats;
  statusEl.checkedIn.textContent = s.checkedIn;
  statusEl.onPlant.textContent = [...plant.allBags()].length;
  statusEl.delivered.textContent = s.delivered[1] + s.delivered[2] + s.delivered[3];
  statusEl.rejected.textContent = s.rejected;

  const err = scan.state === 'STOP' ? scan.error : null;
  statusEl.restart.hidden = !err;
  if (err !== shownError) {
    shownError = err;
    statusEl.error.hidden = !err;
    statusEl.error.textContent = err ? `CPU i STOP – ${err.message}` : '';
    if (err) stview.showError(err.message, err.line || 0);
  }
}

const drawPlant = () => renderer.update(panel.selection, { fault: !plant.operator.estopOk || scan.state === 'STOP' });

function refreshUi() {
  drawPlant();
  updateStatus();
  updateAlarms();
  panel.refresh();
  stview.update();
}

// ---- loops ----
let last = performance.now();
let sinceUi = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!sim.paused) plant.step(dt * speed);
  drawPlant();
  sinceUi += dt;
  if (sinceUi > 0.2) {
    sinceUi = 0;
    updateStatus();
    updateAlarms();
    panel.refresh();
    stview.update();
  }
  requestAnimationFrame(frame);
}

scan.start(speed, () => !sim.paused);
requestAnimationFrame(frame);

// Debug handle for the browser console (and the smoke test): window.bagageHmi.plant etc.
window.bagageHmi = { plant, image, scan, sim, stview, alarmLog };
