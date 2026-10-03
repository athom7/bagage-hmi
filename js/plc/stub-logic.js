// TEMP phase 1 – replaced by plc/program.st in phase 2.
// Temporary control logic written in JavaScript so the plant can run before the ST interpreter exists.
// It only touches the I/O image (image.I read, image.Q written), exactly like the ST program will.

// Tiny function-block helpers, same behaviour as IEC TON / R_TRIG / F_TRIG.
const ton = (ptMs) => {
  let et = 0;
  return (inp, dtMs) => {
    et = inp ? Math.min(ptMs, et + dtMs) : 0;
    return et >= ptMs;
  };
};
const rTrig = () => {
  let prev = false;
  return (v) => {
    const q = v && !prev;
    prev = v;
    return q;
  };
};

export function createStubProgram() {
  const fifo = { 1: [], 2: [], 3: [] }; // destination of each bag between ATR and diverter k
  const hold = { 1: false, 2: false, 3: false }; // diverter k wanted out
  const rel = { 1: false, 2: false }; // check-in belt n released towards the merge
  let turn = 1; // which check-in belt gets the next release
  const mergeGap = ton(500);
  const atrEdge = rTrig();
  const mergeEdge = rTrig();
  const peEdge = { 1: rTrig(), 2: rTrig(), 3: rTrig() };
  const retract = { 1: ton(600), 2: ton(600), 3: ton(600) };

  return {
    name: 'stub-logic.js (midlertidig)',
    execute(image, { dtMs }) {
      const I = image.I;
      const Q = image.Q;
      const run = I.I_EStop_OK;

      // --- merge: check-in belts take turns, with a gap between bags ---
      const gapOk = mergeGap(!I.I_PE_Merge, dtMs);
      if (mergeEdge(I.I_PE_Merge)) {
        rel[1] = false;
        rel[2] = false;
      }
      if (run && !rel[1] && !rel[2] && !I.I_PE_Merge && gapOk) {
        const w1 = I.I_PE_CI1;
        const w2 = I.I_PE_CI2;
        if (w1 && (turn === 1 || !w2)) { rel[1] = true; turn = 2; }
        else if (w2) { rel[2] = true; turn = 1; }
      }
      Q.Q_M_CI1 = run && (!I.I_PE_CI1 || rel[1]);
      Q.Q_M_CI2 = run && (!I.I_PE_CI2 || rel[2]);
      Q.Q_M_Main = run;

      // --- tracking: ATR pushes destination, each diverter pops from its own FIFO ---
      if (atrEdge(I.I_ATR_Read)) fifo[1].push(I.I_ATR_Dest);
      for (const k of [1, 2, 3]) {
        if (peEdge[k](I[`I_PE_D${k}`])) {
          const dest = fifo[k].shift();
          if (dest === k) hold[k] = true;
          else if (dest !== undefined && k < 3) fifo[k + 1].push(dest); // not for me: pass it on
        }
        if (retract[k](hold[k] && !I[`I_PE_D${k}`], dtMs)) hold[k] = false;
        Q[`Q_Div${k}`] = run && hold[k];
        Q[`Q_M_G${k}`] = run;
      }

      Q.Q_Lamp_Run = run;
      Q.Q_Lamp_Fault = false;
    },
  };
}
