// The I/O layer between field (plant) and PLC.
// readInputs(): the only place that reads the plant. writeOutputs(): the only place that writes to it.

import { SENSORS, DIVERTERS } from '../plant/layout.js';

const MOTORS = {
  CI1: 'Q_M_CI1', CI2: 'Q_M_CI2', MAIN: 'Q_M_Main',
  G1: 'Q_M_G1', G2: 'Q_M_G2', G3: 'Q_M_G3',
};

export function readInputs(plant, image) {
  const I = image.I;
  I.I_EStop_OK = plant.operator.estopOk;
  I.I_Start = plant.operator.start;
  I.I_Stop = plant.operator.stop;
  I.I_Reset = plant.operator.reset;
  for (const s of SENSORS) I[s.tag] = plant.isBlocked(s.id);
  I.I_ATR_Read = plant.atrActive();
  I.I_ATR_Dest = plant.atr.dest;
  for (const d of DIVERTERS) I[`I_Div${d.id}_Ext`] = plant.armExtended(d.id);
}

export function writeOutputs(image, plant) {
  const Q = image.Q;
  for (const [belt, tag] of Object.entries(MOTORS)) plant.setMotor(belt, Q[tag]);
  for (const d of DIVERTERS) plant.setArmCommand(d.id, Q[`Q_Div${d.id}`]);
  plant.lamps.run = Q.Q_Lamp_Run;
  plant.lamps.fault = Q.Q_Lamp_Fault;
}
