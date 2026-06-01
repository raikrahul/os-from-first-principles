CH11 MEMORY ORDER AND THE GATE-CELL. USES CH01 (bit, named cell, memory+place
number, one instruction then the next) and CH08 (gate-cell, SWAPSET, two cores).
EACH LINE USES ONLY EARLIER LINES.

L1. a write "X = 1" is two events: (1) the instruction runs on the core, (2) the
 new value reaches shared memory where other cores read it. between
 them the value sits in a per-core holding spot. event 2 can be delayed.

L2. two cores. shared cells X=0, Y=0.
 core A: X = 1 ; Y = 1
 core B: wait until Y == 1 ; read X
 A issues X=1 then Y=1. but event-2 of Y=1 may reach memory BEFORE event-2 of
 X=1 (holding spot drains out of order).

L3. TRACE the bad order. A's Y=1 reaches memory first. B sees Y==1, stops
 waiting, reads X. X=1 has not reached memory yet (still in A's holding spot).
 B reads X = 0.

B reads X = ____ in this bad order (0, X=1 not yet visible)

L4. a fence instruction: drain this core's holding spot fully before any later
 write. put it between the two writes:
 core A: X = 1 ; FENCE ; Y = 1
 now X=1 reaches memory before Y=1 can. B sees Y==1 only after X=1 is visible,
 so B reads X = 1.

with FENCE between, B reads X = ____ (1)

L5. the gate-cell from CH08 needs two fences, not just SWAPSET.
 TAKE: SWAPSET the gate to 1 , THEN FENCE. the fence-after stops the
 protected reads/writes from drifting UP before the gate is held.
 GIVE: FENCE, THEN write 0 to the gate. the fence-before forces all protected
 writes to reach memory BEFORE the gate shows free, so the next taker sees
 finished data.

GIVE without the fence-before: another core takes the gate and may read
 ____ (half-written / stale data)

L6. apply to CH07 transmit (the card). steps 4..7 wrote shared memory (the note);
 step8 wrote the card register (the doorbell). the card reads the note out of
 shared memory on its own. without a FENCE before step8, step8's value can
 reach the card before steps 4..7 reach memory -> the card reads a half-written
 note.

no FENCE before the doorbell. the card may read a ____ note (half-written)

L7. SWAPSET itself is one indivisible event: between its read of the
 gate and its write of 1, no other core can act. that solves WHICH core wins.
 the fences solve WHEN the protected data is visible. two different jobs;
 you need both.

SWAPSET alone (no fences) decides the winner but not the data ____
 (visibility / ordering)

================================================================================
GRILL
core A: X=1; Y=1 (no fence). core B waits Y==1 then reads X. B can read X=?
add FENCE between A's two writes. now B reads X = ?
gate TAKE order: SWAPSET to 1, then ? (what instruction)
gate GIVE order: ? then write 0 to the gate.
CH07 doorbell (step8) with no fence before it: the card may read a ? note.
SWAPSET decides the winning core. does it also guarantee the protected data
 is visible to the next taker? (yes/no)

ANSWERS.
0
1
FENCE (fence after take)
FENCE (fence before give)
half-written
no (that needs the fences)
================================================================================
NAMES.
 holding spot = store buffer
 value reaching memory = global visibility / cache coherence
 FENCE = __sync_synchronize / fence rw,rw
 TAKE = SWAPSET+fence = acquire (amoswap + acquire barrier)
 GIVE = fence+write 0 = release (release barrier + store 0)
 doorbell fence (CH07) = __sync_synchronize before regs[E1000_TDT]
================================================================================
