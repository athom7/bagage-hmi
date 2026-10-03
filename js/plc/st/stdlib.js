// Standard function blocks: TON, TOF, R_TRIG, F_TRIG, CTU (IEC 61131-3) and FIFO (simplification, not IEC standard).
// A block instance keeps its own state between scans. `exec` runs once per call, with the current input values in `s.in`.
// ctx.dtMs is the scan period in (simulated) milliseconds.

const wrap16 = (v) => ((((v + 32768) % 65536) + 65536) % 65536) - 32768;
export { wrap16 };

export const FIFO_CAPACITY = 16;

export const FB_TYPES = {
  // On-delay timer: Q goes TRUE when IN has been TRUE for PT.
  TON: {
    inputs: { IN: 'BOOL', PT: 'TIME' },
    outputs: { Q: 'BOOL', ET: 'TIME' },
    create: () => ({ in: { IN: false, PT: 0 }, out: { Q: false, ET: 0 }, mem: {} }),
    exec(s, ctx) {
      s.out.ET = s.in.IN ? Math.min(s.in.PT, s.out.ET + ctx.dtMs) : 0;
      s.out.Q = s.in.IN && s.out.ET >= s.in.PT;
    },
  },

  // Off-delay timer: Q stays TRUE for PT after IN has gone FALSE.
  TOF: {
    inputs: { IN: 'BOOL', PT: 'TIME' },
    outputs: { Q: 'BOOL', ET: 'TIME' },
    create: () => ({ in: { IN: false, PT: 0 }, out: { Q: false, ET: 0 }, mem: {} }),
    exec(s, ctx) {
      if (s.in.IN) {
        s.out.Q = true;
        s.out.ET = 0;
      } else if (s.out.Q) {
        s.out.ET = Math.min(s.in.PT, s.out.ET + ctx.dtMs);
        if (s.out.ET >= s.in.PT) s.out.Q = false;
      }
    },
  },

  // Rising edge: Q is TRUE for exactly one scan when CLK goes FALSE -> TRUE.
  R_TRIG: {
    inputs: { CLK: 'BOOL' },
    outputs: { Q: 'BOOL' },
    create: () => ({ in: { CLK: false }, out: { Q: false }, mem: { prev: false } }),
    exec(s) {
      s.out.Q = s.in.CLK && !s.mem.prev;
      s.mem.prev = s.in.CLK;
    },
  },

  // Falling edge: Q is TRUE for exactly one scan when CLK goes TRUE -> FALSE.
  F_TRIG: {
    inputs: { CLK: 'BOOL' },
    outputs: { Q: 'BOOL' },
    create: () => ({ in: { CLK: false }, out: { Q: false }, mem: { prev: false } }),
    exec(s) {
      s.out.Q = !s.in.CLK && s.mem.prev;
      s.mem.prev = s.in.CLK;
    },
  },

  // Up counter: counts rising edges on CU. RESET sets CV to 0. Q = CV >= PV.
  CTU: {
    inputs: { CU: 'BOOL', RESET: 'BOOL', PV: 'INT' },
    outputs: { Q: 'BOOL', CV: 'INT' },
    create: () => ({ in: { CU: false, RESET: false, PV: 0 }, out: { Q: false, CV: 0 }, mem: { prev: false } }),
    exec(s) {
      if (s.in.RESET) s.out.CV = 0;
      else if (s.in.CU && !s.mem.prev && s.out.CV < 32767) s.out.CV++;
      s.mem.prev = s.in.CU;
      s.out.Q = s.out.CV >= s.in.PV;
    },
  },

  // First-in-first-out queue of INT values (shift register). Not an IEC standard block;
  // comparable to library blocks in Codesys/OSCAT. PUSH and POP act on every scan where they are TRUE,
  // so drive them with edge pulses (R_TRIG.Q). Order inside one call: RESET, POP, PUSH.
  //   OUT   = value taken by the latest POP (0 when the queue was empty)
  //   UF    = TRUE when POP found the queue empty (tracking lost)
  //   OVF   = TRUE when PUSH found the queue full
  FIFO: {
    inputs: { PUSH: 'BOOL', IN: 'INT', POP: 'BOOL', RESET: 'BOOL' },
    outputs: { OUT: 'INT', EMPTY: 'BOOL', FULL: 'BOOL', COUNT: 'INT', UF: 'BOOL', OVF: 'BOOL' },
    create: () => ({
      in: { PUSH: false, IN: 0, POP: false, RESET: false },
      out: { OUT: 0, EMPTY: true, FULL: false, COUNT: 0, UF: false, OVF: false },
      mem: { queue: [] },
    }),
    exec(s) {
      const q = s.mem.queue;
      if (s.in.RESET) q.length = 0;
      s.out.UF = false;
      s.out.OVF = false;
      if (s.in.POP) {
        if (q.length) s.out.OUT = q.shift();
        else { s.out.OUT = 0; s.out.UF = true; }
      }
      if (s.in.PUSH) {
        if (q.length < FIFO_CAPACITY) q.push(s.in.IN);
        else s.out.OVF = true;
      }
      s.out.COUNT = q.length;
      s.out.EMPTY = q.length === 0;
      s.out.FULL = q.length >= FIFO_CAPACITY;
    },
  },
};
