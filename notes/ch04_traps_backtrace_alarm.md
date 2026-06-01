CH04 TRAPS, BACKTRACE, ALARM. USES CH01 (bit, byte, hex, memory+place number,
named cell, PC, PC+4, jump) and CH02 (MODE bit, DOOR/UNDOOR, save area).
EACH LINE USES ONLY EARLIER LINES.

L1. a scratch area is memory used top-down: a named cell SP holds the
 low edge. push = SP - 8 (record is 8 bytes), then write at SP. higher
 place-numbers are older.

L2. block X jumps into block Y. X writes the come-back place (the
 instruction after the jump) into a record, call it RA. Y saves X's frame-edge
 number, call it FP-old. each block leaves [RA][FP-old].

L3. a named cell FP holds the start of the current footprint. RA sits at FP - 8.
 FP-old sits at FP - 16 (two 8-byte records below FP).

 FP - 8 holds ____ (RA). FP - 16 holds ____ (FP-old).

L4. FP = 0x3FFFFE0.
 RA address = 0x3FFFFE0 - 8 = ____ (0x3FFFFD8); read it, say 0x80001234.
 FP-old address = 0x3FFFFE0 - 16 = ____ (0x3FFFFD0); read it, say 0x3FFFFF0.
 print 0x80001234. set FP = 0x3FFFFF0. repeat.

L5. the scratch area is one 4096-chunk (2^12 = 4096). round FP up to the
 next multiple of 4096 = its top edge. walk while FP < that top; at the top the
 chain is done (older than the chunk = not ours).
 0x3FFFFE0 -> next 4096 multiple = 0x4000000.

 FP = 0x4000000. is FP < 0x4000000 ? ____ (no, stop).

L6. the save area holds the user numbers and the come-back place EPC
. a number T counts up by 1 each timer tick. the program asked: after
 N ticks run my handler at place H, once.

L7. each tick, if T reaches N and not already in the handler:
 save the WHOLE save area into a backup chunk (the handler will overwrite it),
 then set the save area's come-back place to H,
 then set a flag ON = 1 so a second tick does not re-enter.
 UNDOOR now returns into H instead of the original place.

L8. when the handler finishes it asks to restore: copy the backup chunk back over
 the save area (original numbers and original come-back place return), then set
 ON = 0.

L9. the save in L7 must happen BEFORE the come-back place is set to H. set it to H
 first and the backup captures H; L8 then restores H; the program never returns
 to its real place and re-runs the handler with no end.

 set come-back = H, then back up. the backup's come-back holds ____ (H, broken).

L10. the flag ON is why a tick during the handler is skipped. without it, a
 second tick backs up the handler's own numbers over the real backup, losing
 the real ones.

 handler running, ON = 1, new tick. re-enter? ____ (no).

L11. the restore must hand back the saved come-back-answer number as its own
 result, or the dispatcher overwrites the answer-cell with the
 restore's return number. returning the saved value makes that overwrite write
 the same number.

 restore returns 0 instead of the saved value. the answer-cell ends as ____
 (0, restored value lost).

================================================================================
GRILL
FP = 0x3FFFFE0. RA address = FP - 8 = ?
FP = 0x3FFFFE0. FP-old address = FP - 16 = ?
scratch chunk 4096, FP = 0x4000000, top = 0x4000000. keep walking?
N = 10, T = 9, a tick arrives, ON = 0. handler fires?
set come-back = H, then back up. backup's come-back holds ?
restore must return which number so the answer-cell survives?

0x3FFFFD8
0x3FFFFD0
no
yes (T becomes 10, reaches N, ON = 0)
H (the break)
the saved answer-cell value
================================================================================
NAMES. scratch area = kernel stack; SP = stack pointer; [RA][FP-old] = saved
return address + saved frame pointer; FP = s0; round up to 4096 = PGROUNDUP;
save area = trapframe; come-back EPC = sepc / trapframe->epc; handler H =
p->handler (sigalarm); backup chunk = p->tf_backup; flag ON = p->alarm_on;
restore = sys_sigreturn (returns trapframe->a0).
================================================================================
