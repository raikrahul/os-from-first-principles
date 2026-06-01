CH10 MAP A FILE INTO USER-NUMBERS (mmap). USES CH01 (named cell, memory+place
number, 4096), CH03 (user-number -> physical chunk via a slot, VALID flag,
failed access -> jump to fix-up), CH05 (failed access fix-up, get a free chunk),
CH09 (a file = list of disk blocks; read bytes from a file at a position).
EACH LINE USES ONLY EARLIER LINES.

L1. a map record holds: start user-number A, length L, allowed-uses (read/write),
 share-flag (shared or private), the file, and a position P0 in the file where
 the range begins. no physical chunk yet.

 map: A=0x6000, L=4096, uses=read+write, share=shared, file=F, P0=0

L2. user touches user-number U in [A, A+L). its slot has VALID=0 (nothing installed). the touch fails and jumps to fix-up (CH03 /),
 handing it U.

U=0x6000, slot VALID=0. the touch ____ (fails -> jump to fix-up)

L3. fix-up: round U down to a 4096 start (CH01 4096): U0 = U - (U mod 4096).
 find the matching map by A <= U < A+L.
 U=0x6000, A=0x6000, L=4096: 0x6000 <= 0x6000 < 0x7000 yes. U0 = 0x6000.

U = 0x6010. U0 = 0x6010 - (0x6010 mod 4096). 0x6010 mod 4096 = 16, so
 U0 = 0x6010 - 16 = ____ (0x6000)

L4. fix-up: get a free chunk N (/). clear it to 0. read 4096
 bytes from the file F at position P0 + (U0 - A) into N (CH09 L-read).
 here U0 - A = 0x6000 - 0x6000 = 0, so read file position 0.

file read position = P0 + (U0 - A) = 0 + (0x6000 - 0x6000) = ____ (0)

L5. fix-up: install the slot (CH03) for U0 -> chunk N, with VALID=1 and the
 allowed-uses from the map (read sets the read flag, write sets W).
 now the touch is retried and succeeds.

after fix-up installs the slot, the retried touch ____ (succeeds)

L6. the file stays usable after its open-handle is closed, because the map holds
 its OWN reference to the file (a separate count). closing the user handle only
 drops the handle, not the map's reference.

user closes the file handle after mapping. the map's file reference ____
 (still held / survives)

L7. unmap a range. for each installed chunk in the range:
 if share=shared AND the chunk was written (a written-flag set by the failed-
 write path or marked at fix-up for write maps), write its 4096 bytes BACK to
 the file at the matching position (CH09 write) before freeing.
 if share=private, discard (do not write back).

shared map, chunk written, unmap. bytes go ____ (back to the file)
private map, chunk written, unmap. bytes go ____ (discarded)

L8. trap: unmap may shrink a range from either end but not punch a hole in the
 middle (that would split one map record into two; the fixed map table has no
 room to grow into two). only prefix or suffix shrink.

unmap the middle of a range. allowed here? ____ (no, only ends)

L9. trap: a touch outside every map's [A, A+L) is a real error (no file backs
 it), not a fix-up case. fix-up must find a matching map first; none found =
 kill the program, do not get a chunk.

touch with no matching map. fix-up ____ (errors / kills, no chunk)

================================================================================
GRILL
U = 0x6010, round down to 4096 start: U0 = 0x6010 - (0x6010 mod 4096) = ?
file read position = P0 + (U0 - A), with P0=0, U0=0x6000, A=0x6000 = ?
first touch of a mapped user-number has slot VALID = ? (0 or 1)
user closes the file handle after mapping. does the mapping still work?
shared map, written chunk, unmap. write back to file? (yes/no)
private map, written chunk, unmap. write back to file? (yes/no)
touch a user-number with no matching map. get a chunk or kill?

ANSWERS.
0x6000
0
0 (nothing installed yet)
yes (map holds its own file reference)
yes
no (discarded)
kill (no backing file)
================================================================================
NAMES.
 map record = struct vma (addr, length, prot, flags, file, offset)
 first-touch fails = page fault, scause 13 (load) or 15 (store)
 fix-up = the mmap fault handler in usertrap
 get a free chunk = kalloc
 read from file = readi(ip,..., offset, PGSIZE)
 install the slot = mappages with PTE_R/PTE_W/PTE_U
 map's file reference = filedup in mmap
 write back on unmap = filewrite / writei for MAP_SHARED dirty pages
 shrink ends only = munmap prefix/suffix, no hole
================================================================================
