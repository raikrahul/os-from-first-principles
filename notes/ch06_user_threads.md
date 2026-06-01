CH06 USER THREADS (CONTEXT SWITCH). USES CH01 (named cell, PC, PC+4, jump,
memory+place number, 8-byte record) and CH04 (scratch area / SP, footprint).
EACH LINE USES ONLY EARLIER LINES.

L1. From CH04: when one block runs another, the come-back place RA and the
 frame-edge SP are cells. The jump-back instruction RET does: read
 RA, set PC = RA (jump). So whatever RA holds, RET goes there.

L2. callee-saved cells: a fixed set the calling rule says a block must leave
 unchanged across running another block. count them: RA, SP, and 12 more
 work-cells = 14 cells, each 8 bytes.

14 cells * 8 bytes = ____ (112, the save record size)

L3. a flow = a paused block plus its saved 14 cells and its own scratch
 area. store the 14 cells in a record CTX, 112 bytes.
 flow A's CTX at 0x5000, flow B's CTX at 0x5200 (112 bytes apart fits: 0x5200
 - 0x5000 = 0x200 = 512 > 112).

L4. SWITCH(oldCTX, newCTX): one block of instructions that
 step1 save the 14 live cells into oldCTX (write 14 records)
 step2 load the 14 cells from newCTX (read 14 records)
 step3 RET (PC = the now-loaded RA)
 because step2 loaded newCTX's RA, step3 jumps into the NEW flow.

SWITCH step2 loaded RA from newCTX. step3 RET sets PC to ____
 (newCTX's saved RA)

L5. TRACE. flow A running, calls SWITCH(&A.ctx, &B.ctx).
 step1 A's RA (say 0x80001000, A's come-back) saved into A.ctx.
 step2 B's RA (say 0x80002000, where B paused) loaded.
 step3 RET -> PC = 0x80002000. B resumes. A is frozen in A.ctx.

after this SWITCH, PC = ____ (0x80002000, B's saved RA)
A's come-back 0x80001000 now sits in ____ (A.ctx, the RA record)

L6. a NEW flow has never run, so its CTX has no real saved RA. CREATE sets it by
 hand: put the new block's start place into the RA record, and the top of a
 fresh scratch area into the SP record.
 new flow F: F.ctx RA = startplace, F.ctx SP = top of F's scratch area.

first time SWITCH loads F.ctx and RETs, PC goes to ____ (startplace)

L7. the 12 work-cells in a fresh CTX are garbage. harmless: the new block's
 first instructions overwrite them before use (the block sets up its own work
 cells). only RA and SP must be correct.

fresh CTX's 12 work-cells are garbage. problem? ____ (no, overwritten)

L8. the new block must NEVER fall off its end with RET, because its CTX RA below
 the start is undefined (only set the start). it must instead call EXIT
 (jump to the chooser, never return). falling off RETs into garbage.

new block runs RET at its end instead of EXIT. PC goes to ____
 (garbage / undefined)

L9. the chooser picks the next flow and SWITCHes to it. a named cell CURRENT
 holds which flow is running now. the order trap:
 wrong: SWITCH first, then set CURRENT=next.
 why wrong: after SWITCH step3 RET , control left this block; the line
 "CURRENT=next" never runs for the new flow. CURRENT stays stale.
 right: capture old=CURRENT; set CURRENT=next; THEN SWITCH(&old.ctx,
 &next.ctx).

set CURRENT=next AFTER SWITCH. does that line run for the new flow? ____
 (no, RET already left)

L10. flow 0 is the chooser itself (its CTX is the chooser's own paused state).
 new worker flows use slots 1,2,3,... not 0. overwriting slot 0's CTX loses
 the come-back into the chooser, so when all workers EXIT there is no valid
 flow to resume.

a worker uses slot 0. when workers finish, the resume target is ____
 (lost / invalid)

================================================================================
GRILL
14 saved cells * 8 bytes = ? (CTX record size)
SWITCH loads newCTX then RETs. PC becomes which saved value?
CREATE sets a new flow's RA record to ? (what place)
fresh CTX's 12 work-cells are garbage. does it break the new block?
a new block ends with RET instead of EXIT. PC goes where?
you set CURRENT=next AFTER calling SWITCH. does that assignment take effect
 for the new flow?

ANSWERS.
112
newCTX's saved RA
the new block's start place (function entry)
no (the block overwrites them)
garbage / undefined (RA below start was never set)
no (RET already transferred control away)
================================================================================
NAMES.
 flow = thread
 14 callee-saved cells= ra, sp, s0..s11
 CTX record = struct context
 SWITCH = thread_switch / swtch (.S)
 RET reads RA = ret reads ra, pc <- ra
 CREATE = thread_create (set ctx.ra=func, ctx.sp=stack top)
 EXIT = thread_exit
 CURRENT cell = current_thread
 chooser / slot 0 = thread_schedule / scheduler thread
================================================================================
