(* ===========================================================================
   BAGGAGE SORTING - control program (Structured Text, IEC 61131-3 style)

   Runs once per scan (every 100 ms). The I/O image is read first, this program
   runs on that frozen snapshot, and the outputs are written to the field last.

   Naming:  I_ input   Q_ output   M_ memory   R_ edge detector
            T_ timer   FIFO_ tracking queue
   PE = photocell, M = motor, Div = diverter (sorting flap), CI = check-in belt.
   Photocells are TRUE while the beam is interrupted by a bag.
   =========================================================================== *)
PROGRAM Baggage

VAR
  // ---- operating mode ----
  M_State     : INT;        // 0 = stopped, 1 = running, 2 = emergency stop latched
  M_Run       : BOOL;       // TRUE while the plant may run
  R_Start     : R_TRIG;
  R_Stop      : R_TRIG;
  R_Reset     : R_TRIG;

  // ---- check-in belts and merge ----
  M_Rel1      : BOOL;       // check-in belt 1 is released towards the main belt
  M_Rel2      : BOOL;
  M_Turn      : INT := 1;   // which check-in belt may send next
  T_MergeGap  : TON;        // keeps a gap between two bags on the main belt
  R_Merge     : R_TRIG;

  // ---- tracking: ATR -> FIFO_1 -> D1 -> FIFO_2 -> D2 -> FIFO_3 -> D3 -> problem station ----
  R_Atr       : R_TRIG;
  R_PE_D1     : R_TRIG;
  R_PE_D2     : R_TRIG;
  R_PE_D3     : R_TRIG;
  FIFO_1      : FIFO;
  FIFO_2      : FIFO;
  FIFO_3      : FIFO;

  // ---- diverters and gates ----
  M_MainOk    : BOOL;       // main belt may run (running, and no waiting bag for a full gate)
  M_Want1     : BOOL;       // a bag for gate 1 is on its way: keep diverter 1 out
  M_Want2     : BOOL;
  M_Want3     : BOOL;
  T_Ret1      : TON;        // retract delay once the bag has passed (counts only while the belt moves)
  T_Ret2      : TON;
  T_Ret3      : TON;
  T_Full1     : TON;        // gate belt is full when its photocell stays blocked for 2 s
  T_Full2     : TON;
  T_Full3     : TON;
END_VAR

// =========================================================================
// 1. OPERATING MODE
//    Start and Stop are push buttons. The emergency stop is a normally closed
//    circuit (I_EStop_OK = FALSE when pressed or when a wire breaks) and has
//    priority. After an emergency stop the plant stays locked until the button
//    is released AND Reset is pressed.
// =========================================================================
R_Start(CLK := I_Start);
R_Stop(CLK := I_Stop);
R_Reset(CLK := I_Reset);

CASE M_State OF
  0:  // stopped
    IF R_Start.Q AND I_EStop_OK THEN
      M_State := 1;
    END_IF;
  1:  // running
    IF R_Stop.Q THEN
      M_State := 0;
    END_IF;
  2:  // emergency stop latched
    IF R_Reset.Q AND I_EStop_OK THEN
      M_State := 0;
    END_IF;
END_CASE;

IF NOT I_EStop_OK THEN
  M_State := 2;
END_IF;

M_Run := M_State = 1;

// =========================================================================
// 2. BAG TRACKING
//    The ATR scanner reads the tag and gives the gate number (0 = invalid).
//    The number goes into FIFO_1. Bags cannot overtake each other on the belt, so
//    the oldest entry always belongs to the next bag reaching a diverter's photocell.
//    That diverter pops the entry: if it is its own gate it swings out, otherwise
//    the number is passed on to the next queue. Invalid bags (0) pass all three
//    diverters and end at the problem station.
// =========================================================================
R_Atr(CLK := I_ATR_Read);
R_PE_D1(CLK := I_PE_D1);
R_PE_D2(CLK := I_PE_D2);
R_PE_D3(CLK := I_PE_D3);

FIFO_1(PUSH := R_Atr.Q, IN := I_ATR_Dest, POP := R_PE_D1.Q);
FIFO_2(PUSH := R_PE_D1.Q AND NOT FIFO_1.UF AND FIFO_1.OUT <> 1, IN := FIFO_1.OUT, POP := R_PE_D2.Q);
FIFO_3(PUSH := R_PE_D2.Q AND NOT FIFO_2.UF AND FIFO_2.OUT <> 2, IN := FIFO_2.OUT, POP := R_PE_D3.Q);

// =========================================================================
// 3. DIVERTERS AND INTERLOCKS
//    The photocell sits 50 units before the flap, so the arm (0.3 s) is out in time.
//    After the LAST bag the arm is retracted 600 ms after it has left the photocell, but
//    only counted while the main belt is actually moving. Otherwise a stop (or a full gate)
//    could retract the arm before the bag has reached it and the bag would be lost.
// =========================================================================

// A gate belt counts as full when its photocell stays blocked for 2 s
// (a bag that is just passing the photocell only blocks it briefly).
T_Full1(IN := I_PE_G1, PT := T#2s);
T_Full2(IN := I_PE_G2, PT := T#2s);
T_Full3(IN := I_PE_G3, PT := T#2s);

// Every bag gets its own decision at the photocell: the arm stays out (TRUE) for a bag bound
// for this gate and is pulled in (FALSE) for any other bag. So a bag that follows closely behind
// a diverted one is never swept into the wrong gate by an arm that is still out.
IF R_PE_D1.Q THEN
  M_Want1 := FIFO_1.OUT = 1;
END_IF;
IF R_PE_D2.Q THEN
  M_Want2 := FIFO_2.OUT = 2;
END_IF;
IF R_PE_D3.Q THEN
  M_Want3 := FIFO_3.OUT = 3;
END_IF;

// Interlock: the main belt waits while the next bag is bound for a gate that is full.
M_MainOk := M_Run AND NOT (M_Want1 AND T_Full1.Q) AND NOT (M_Want2 AND T_Full2.Q) AND NOT (M_Want3 AND T_Full3.Q);

T_Ret1(IN := M_Want1 AND NOT I_PE_D1 AND M_MainOk, PT := T#600ms);
T_Ret2(IN := M_Want2 AND NOT I_PE_D2 AND M_MainOk, PT := T#600ms);
T_Ret3(IN := M_Want3 AND NOT I_PE_D3 AND M_MainOk, PT := T#600ms);

IF T_Ret1.Q THEN
  M_Want1 := FALSE;
END_IF;
IF T_Ret2.Q THEN
  M_Want2 := FALSE;
END_IF;
IF T_Ret3.Q THEN
  M_Want3 := FALSE;
END_IF;

// =========================================================================
// 4. MERGE OF THE TWO CHECK-IN BELTS
//    A belt is only released when the merge is free and has been free for 700 ms
//    of MOVING belt time. Counting only while the main belt runs matters: if it is
//    held (full gate) or stopped, the previous bag has not moved on, and the next
//    bag would be released too close behind it. A gap smaller than about 10 units
//    cannot be seen by a photocell scanned every 100 ms.
//    The belts take turns, so neither counter can starve the other.
//    The release is held until the bag has reached the merge photocell.
// =========================================================================
T_MergeGap(IN := NOT I_PE_Merge AND M_MainOk, PT := T#700ms);
R_Merge(CLK := I_PE_Merge);

IF R_Merge.Q THEN
  M_Rel1 := FALSE;
  M_Rel2 := FALSE;
END_IF;

IF M_MainOk AND NOT M_Rel1 AND NOT M_Rel2 AND NOT I_PE_Merge AND T_MergeGap.Q THEN
  IF I_PE_CI1 AND (M_Turn = 1 OR NOT I_PE_CI2) THEN
    M_Rel1 := TRUE;
    M_Turn := 2;
  ELSIF I_PE_CI2 THEN
    M_Rel2 := TRUE;
    M_Turn := 1;
  END_IF;
END_IF;

// =========================================================================
// 5. OUTPUTS
// =========================================================================
Q_M_CI1 := M_Run AND (NOT I_PE_CI1 OR M_Rel1);
Q_M_CI2 := M_Run AND (NOT I_PE_CI2 OR M_Rel2);

Q_M_Main := M_MainOk;

Q_M_G1 := M_Run;
Q_M_G2 := M_Run;
Q_M_G3 := M_Run;

Q_Div1 := M_Want1;
Q_Div2 := M_Want2;
Q_Div3 := M_Want3;

Q_Lamp_Run := M_Run;
Q_Lamp_Fault := M_State = 2;

END_PROGRAM
