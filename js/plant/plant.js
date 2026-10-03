// The plant (field level): belts, bags, diverter arms, gate loaders, sensors.
// Pure physics. It knows nothing about the PLC, tags or the DOM:
// it only exposes what a real field device would: sensor states and actuator inputs.

import { BELTS, BELT_ORDER, COUNTERS, DIVERTERS, SENSORS, ATR, GAP } from './layout.js';
import { createBag } from './bag.js';
import { generateBagSpec, makeRng } from './flights.js';

const ARM_TRAVEL_S = 0.3; // time for a diverter arm to swing fully out or in
const ARM_ENGAGED = 0.85; // arm position at which it will catch a passing bag
const ARM_EXT = 0.99; // arm position at which the end switch reports "extended"
const ATR_PULSE_S = 0.15; // the scanner output stays high this long after a read
const MAX_STEP_S = 0.02;
const QUEUE_MAX = 6;
// A counter hands over one bag at a time. Keeping a real gap between bags is what lets a photocell
// (sampled every 100 ms by the PLC) tell two bags apart; bags closer than about 10 units would blur into one.
const SPAWN_GAP = 80;

export class Plant {
  constructor({ seed = 7 } = {}) {
    this.seed = seed;
    this.reset();
  }

  reset() {
    this.rng = makeRng(this.seed);
    this.time = 0;
    this.seq = 0;
    this.belts = {};
    for (const def of Object.values(BELTS)) this.belts[def.id] = { def, motorOn: false, bags: [] }; // bags: front (highest pos) first
    this.counters = {};
    for (const id of Object.keys(COUNTERS)) this.counters[id] = { queued: 0, pending: null };
    this.diverters = {};
    for (const d of DIVERTERS) this.diverters[d.id] = { cmd: false, pos: 0 };
    this.gates = {};
    for (const d of DIVERTERS) this.gates[d.id] = { loaderActive: true, nextUnload: 6 + d.id };
    this.atr = { readUntil: -1, dest: 0, lastReadAt: -10 };
    this.operator = { start: false, stop: false, reset: false, estopOk: true };
    this._releaseAt = {}; // push buttons are released automatically after a short press
    this.lamps = { run: false, fault: false };
    this.stats = { checkedIn: 0, delivered: { 1: 0, 2: 0, 3: 0 }, rejected: 0, misrouted: 0 };
    this.autoRate = this.autoRate || 0; // bags per minute, all counters together (a setting: survives a reset)
    this._autoAcc = 0;
  }

  // ---- field interface: what the I/O layer may read and write -------------

  isBlocked(sensorId) {
    const s = SENSORS.find((x) => x.id === sensorId);
    return this.belts[s.belt].bags.some((b) => Math.abs(b.pos - s.pos) < b.len / 2 + (s.reach || 0));
  }
  atrActive() { return this.time < this.atr.readUntil; }
  armExtended(divId) { return this.diverters[divId].pos >= ARM_EXT; }
  setMotor(beltId, on) { this.belts[beltId].motorOn = !!on; }
  setArmCommand(divId, on) { this.diverters[divId].cmd = !!on; }

  // ---- operator / HMI-side field actions -----------------------------------

  enqueueBag(counterId) {
    const c = this.counters[counterId];
    if (c.queued >= QUEUE_MAX) return false;
    c.queued++;
    return true;
  }
  setLoaderActive(gate, on) { this.gates[gate].loaderActive = !!on; }

  // Momentary push button (start | stop | reset). The press length is simulated time, so the
  // PLC sees it for at least two scans at any simulation speed.
  pressButton(name, seconds = 0.3) {
    this.operator[name] = true;
    this._releaseAt[name] = this.time + seconds;
  }
  // Mushroom emergency stop button: stays pressed until it is released (twisted) again.
  setEmergencyStop(pressed) { this.operator.estopOk = !pressed; }

  *allBags() {
    for (const b of Object.values(this.belts)) yield* b.bags;
  }
  findBag(id) {
    for (const b of this.allBags()) if (b.id === id) return b;
    return null;
  }

  // ---- simulation ----------------------------------------------------------

  step(dt) {
    let rest = dt;
    while (rest > 1e-9) {
      const h = Math.min(MAX_STEP_S, rest);
      this._tick(h);
      rest -= h;
    }
  }

  _tick(h) {
    this.time += h;
    for (const [name, t] of Object.entries(this._releaseAt)) {
      if (this.time >= t) {
        this.operator[name] = false;
        delete this._releaseAt[name];
      }
    }
    this._autoGenerate(h);
    this._spawn();
    for (const [id, a] of Object.entries(this.diverters)) {
      const target = a.cmd ? 1 : 0;
      const dpos = h / ARM_TRAVEL_S;
      a.pos = a.pos < target ? Math.min(target, a.pos + dpos) : Math.max(target, a.pos - dpos);
    }
    for (const id of BELT_ORDER) this._moveBelt(this.belts[id], h);
    this._loaders();
  }

  _autoGenerate(h) {
    if (this.autoRate <= 0) return;
    this._autoAcc += (h * this.autoRate) / 60;
    while (this._autoAcc >= 1) {
      this._autoAcc -= 1;
      this.enqueueBag(this.rng() < 0.5 ? 'CI1' : 'CI2');
    }
  }

  _spawn() {
    for (const [id, c] of Object.entries(this.counters)) {
      if (c.queued <= 0) continue;
      if (!c.pending) c.pending = generateBagSpec(this.rng);
      const belt = this.belts[id];
      const last = belt.bags[belt.bags.length - 1];
      const needed = c.pending.len + 2 + SPAWN_GAP;
      if (last && last.pos - last.len / 2 < needed) continue; // entry occupied
      const bag = createBag(++this.seq, c.pending, id, this.time);
      belt.bags.push(bag);
      c.pending = null;
      c.queued--;
      this.stats.checkedIn++;
    }
  }

  _moveBelt(belt, h) {
    // The emergency stop circuit is hard-wired: it cuts motor power directly, independent of the PLC.
    if (!belt.motorOn || !this.operator.estopOk) return;
    const d = belt.def;
    let ahead = null; // nearest bag in front that is still on this belt
    for (const bag of belt.bags.slice()) { // front first
      const old = bag.pos;
      let np = old + d.speed * h;

      // Limit: the bag ahead (on this belt, or at the start of the next belt), or the end stop.
      let limit = Infinity;
      if (ahead) {
        limit = ahead.pos - (ahead.len + bag.len) / 2 - GAP;
      } else if (d.next) {
        const nb = this.belts[d.next];
        const f = nb.bags[nb.bags.length - 1];
        if (f) limit = d.length + f.pos - (f.len + bag.len) / 2 - GAP;
      } else if (!d.sink) {
        limit = d.length - bag.len / 2 - 1;
      }
      np = Math.max(old, Math.min(np, limit));

      if (d.id === 'MAIN') {
        if (old < ATR.pos && np >= ATR.pos) this._atrRead(bag);
        if (this._tryDivert(belt, bag, old, np)) continue; // left the belt: `ahead` is unchanged
        for (const dv of DIVERTERS) {
          // Arm is out but the gate belt cannot take the bag: hold it right before the diverter.
          if (old < dv.pos && np >= dv.pos && this.diverters[dv.id].pos >= ARM_ENGAGED) np = dv.pos - 0.01;
        }
      }

      if (np >= d.length && d.next) {
        this._remove(belt, bag);
        bag.pos = np - d.length;
        bag.belt = d.next;
        bag.history.push(d.next);
        this.belts[d.next].bags.push(bag);
      } else if (np >= d.length && d.sink) {
        this._remove(belt, bag);
        this._reject(bag);
      } else {
        bag.pos = np;
        ahead = bag;
      }
    }
  }

  _tryDivert(belt, bag, old, np) {
    for (const dv of DIVERTERS) {
      if (!(old < dv.pos && np >= dv.pos)) continue;
      if (this.diverters[dv.id].pos < ARM_ENGAGED) continue;
      const gate = this.belts['G' + dv.id];
      const f = gate.bags[gate.bags.length - 1];
      const entry = np - dv.pos; // how far past the diverter the bag has already moved this tick
      if (f && f.pos - f.len / 2 - GAP < entry + bag.len / 2) return false; // gate belt entry occupied
      this._remove(belt, bag);
      bag.pos = entry;
      bag.belt = 'G' + dv.id;
      bag.history.push('DIV' + dv.id, bag.belt);
      gate.bags.push(bag);
      return true;
    }
    return false;
  }

  _atrRead(bag) {
    bag.scanned = true;
    this.atr.dest = bag.gate; // 0 = no valid destination
    this.atr.readUntil = this.time + ATR_PULSE_S;
    this.atr.lastReadAt = this.time;
  }

  _reject(bag) {
    bag.status = 'rejected';
    bag.tEnd = this.time;
    bag.history.push('REJ');
    this.stats.rejected++;
    if (bag.gate !== 0) {
      bag.misrouted = true; // had a valid destination but missed its diverter
      this.stats.misrouted++;
    }
  }

  _loaders() {
    for (const d of DIVERTERS) {
      const gate = this.gates[d.id];
      if (!gate.loaderActive || this.time < gate.nextUnload) continue;
      const belt = this.belts['G' + d.id];
      const front = belt.bags[0];
      if (front && front.pos >= belt.def.length - front.len / 2 - 8) {
        this._remove(belt, front);
        front.status = 'delivered';
        front.tEnd = this.time;
        this.stats.delivered[d.id]++;
        if (front.gate !== d.id) {
          front.misrouted = true;
          this.stats.misrouted++;
        }
        gate.nextUnload = this.time + 5 + this.rng() * 4;
      } else {
        gate.nextUnload = this.time + 0.5;
      }
    }
  }

  _remove(belt, bag) {
    const i = belt.bags.indexOf(bag);
    if (i >= 0) belt.bags.splice(i, 1);
  }
}
