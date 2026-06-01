CH05 COPY-ON-WRITE FORK. USES CH01 (bit, byte, memory+place number, named cell)
and CH03 (user-number -> physical chunk via a slot, VALID + flag bits, 4096-chunk).
EACH LINE USES ONLY EARLIER LINES.

L1. From CH03: a slot holds a physical chunk place-number plus low flag units.
 add one more flag: W (write-allowed, bit). W=1 write ok, W=0 write
 fails. add another flag COW (this slot is a shared-until-write copy).

L2. a counter per physical chunk: COUNT = how many slots point at this chunk.
 stored in an array indexed by chunk-number (chunk place / 4096).
 start: a fresh chunk has COUNT=1.

L3. FORK without copying data. for each of the parent's slots that has VALID=1:
 step1 clear W in the PARENT slot (W=0) and set COW=1.
 step2 make the child slot a copy of the parent slot (same physical chunk, same
 W=0, COW=1).
 step3 COUNT[that chunk] = COUNT + 1 (now 2 slots share it).

 parent slot: chunk 0x90000, W=0, COW=1
 child slot: chunk 0x90000, W=0, COW=1
 COUNT[0x90000] = 2

after fork, both point at chunk ____ , W = ____ (0x90000, 0)
COUNT[0x90000] = ____ (2)

L4. parent writes user-number U whose slot has W=0. the write fails and jumps to
 fix-up code (jump triggered by the failed write), handing it U.

L5. fix-up reads U's slot (CH03 descents). it has COW=1, so this is a share, not
 an illegal write.
 read COUNT[chunk].

L6. case COUNT > 1 (still shared). allocate a NEW physical chunk N (get a
 free chunk). copy 4096 bytes from the old chunk to N (byte copy).
 set U's slot: chunk = N, W=1, COW=0. then COUNT[old] = COUNT - 1.

 before: U slot chunk 0x90000, W=0, COW=1, COUNT[0x90000]=2
 get N = 0xA0000. copy 4096 bytes 0x90000 -> 0xA0000.
 after: U slot chunk 0xA0000, W=1, COW=0. COUNT[0x90000] = 2-1 = 1

after fix-up, U points at chunk ____ , W = ____ (0xA0000, 1)
COUNT[0x90000] = 2 - 1 = ____ (1)

L7. case COUNT == 1 (nobody else shares it now). do NOT allocate. just set W=1,
 COW=0 in place. the chunk is already private.

COUNT[chunk]=1 on a write fault. allocate a new chunk? ____ (no)

L8. the conversion cache may still hold the old (U -> old chunk, W=0).
 after changing the slot, clear that cached entry or the next write re-faults
 or uses the stale read-only result. (force a re-read of the slot.)

you fixed the slot but left the stale cache. next write to U ____
 (faults again / uses stale W=0)

L9. the boot-code writing into user memory (CH02 service handlers) does NOT go
 through the failing-write path (it writes via the conversion by hand, CH03).
 so it must run the SAME fix-up itself before writing, or it silently
 writes into a shared chunk and corrupts the other side.

a service copies bytes into a COW user chunk without fix-up. the other
 side's bytes are ____ (corrupted / changed unexpectedly)

L10. fork-then-replace. child forks then immediately loads a different program
 (drops all its slots). did the up-front data copy waste work? the data was
 never copied (only copied slots and bumped COUNT, no 4096-byte copies). so
 no waste. only the slots were copied, then discarded.

fork then replace-program. how many 4096-byte data copies happened? ____
 (0)

================================================================================
GRILL
after fork, COUNT of a shared chunk = ?
write fault, slot COW=1, COUNT=2. allocate new chunk? (yes/no)
same, after copy: COUNT[old] = 2 - 1 = ?
write fault, slot COW=1, COUNT=1. allocate? (yes/no)
fork then immediately load another program. number of 4096-byte data
 copies performed = ?
boot-code writes into a COW user chunk without running fix-up. other side
 corrupted? (yes/no)

ANSWERS.
2
yes
1
no
0
yes
================================================================================
NAMES.
 slot + flags = PTE with PTE_V, PTE_W, PTE_COW
 W flag = PTE_W (write permission)
 COW flag = a reserved PTE bit marking copy-on-write
 COUNT array = per-page reference count (kref_count)
 failed write -> jump = store page fault, scause 15
 fix-up code = the COW handler in usertrap
 get a free chunk = kalloc
 conversion cache = TLB (needs sfence.vma after the slot change)
 boot-code path = copyout (must replicate COW logic)
 fork then replace = fork + exec
================================================================================
