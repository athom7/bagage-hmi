// PLC scan cycle: read inputs -> run program -> write outputs. Fixed order, fixed period.
// The PLC clock is simulated (scan count x period), so timers behave the same at every simulation speed.

export class Scan {
  constructor({ plant, image, program, readInputs, writeOutputs, periodMs = 100 }) {
    this.plant = plant;
    this.image = image;
    this.program = program;
    this.readInputs = readInputs;
    this.writeOutputs = writeOutputs;
    this.periodMs = periodMs;
    this.state = 'RUN'; // RUN | STOP
    this.error = null;
    this.count = 0;
    this.execMs = 0; // wall-clock time the last program run took
    this.timer = null;
  }

  // CPU to STOP: all outputs FALSE and written to the field once, then no more scans.
  stopWithError(err) {
    this.state = 'STOP';
    this.error = err;
    for (const k of Object.keys(this.image.Q)) this.image.Q[k] = false;
    this.writeOutputs(this.image, this.plant);
  }

  // Cold restart: new program instance (all program memory cleared), outputs FALSE, CPU back to RUN.
  coldStart(program) {
    this.program = program;
    this.state = 'RUN';
    this.error = null;
    for (const k of Object.keys(this.image.Q)) this.image.Q[k] = false;
  }

  runOnce() {
    if (this.state !== 'RUN') return;
    const t0 = performance.now();
    this.readInputs(this.plant, this.image); // 1. inputs
    try {
      this.program.execute(this.image, { nowMs: this.count * this.periodMs, dtMs: this.periodMs }); // 2. logic
    } catch (err) {
      this.stopWithError(err); // CPU goes to STOP: all outputs FALSE
      return;
    }
    this.writeOutputs(this.image, this.plant); // 3. outputs
    this.count++;
    this.execMs = performance.now() - t0;
  }

  // `speed` shortens the real interval so the simulation can run faster than real time.
  start(speed = 1, shouldRun = () => true) {
    this.stop();
    this.timer = setInterval(() => {
      if ((typeof document === 'undefined' || !document.hidden) && shouldRun()) this.runOnce();
    }, this.periodMs / speed);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
