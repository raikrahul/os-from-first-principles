CH08 LOCK LAB. USES CH01 (bit, byte, memory+address, register, PC). EACH LINE
USES ONLY EARLIER LINES.


L1. A chunk is 4096 byte-cells in a row. 4096 = hex 1000.
 Memory holds many chunks back to back. chunk start addresses step by 4096.
 chunk at 0x80000, next at 0x80000+4096 = 0x81000, next 0x82000,...

0x80000 = 8*16^4 = 8*65536 = ____ (524288)
next chunk = 524288 + 4096 = ____ (528384 = 0x81000)

L2. A free chunk stores, in its first 8 bytes (an address is 8 bytes),
 the address of the next free chunk. Last free chunk stores 0 (means "none").
 This is the free list.

 START -> 0x80000 -> 0x82000 -> 0
 meaning: memory[0x80000 first 8 bytes] = 0x82000
 memory[0x82000 first 8 bytes] = 0

L3. START is one cell holding the address of the first free chunk.
 START = 0x80000.

follow START: first free chunk = ____ (0x80000)
read its first 8 bytes -> next = ____ (0x82000)
read 0x82000 first 8 bytes -> next = ____ (0, list ends)

L4. FREE a chunk = push to front. two writes. free chunk at 0x90000:
 write1: memory[0x90000 first 8 bytes] = START (= 0x80000)
 write2: START = 0x90000

 after: START -> 0x90000 -> 0x80000 -> 0x82000 -> 0

after free, START = ____ (0x90000)
0x90000 first 8 bytes now = ____ (0x80000)

L5. GET a chunk = pop front. read START, set START to that chunk's next.
 before: START -> 0x90000 -> 0x80000 -> 0
 take 0x90000. its next = 0x80000.
 START = 0x80000.
 hand 0x90000 to caller.

GET returns ____ (0x90000)
after GET, START = ____ (0x80000)

L6. Now cores. A core is a copy of the chip (CH01: PC + registers). Say 8 cores,
 numbered 0..7. All 8 run GET/FREE on the SAME START.

L7. A gate-cell is one register holding 0 (free) or 1 (held). One
 instruction SWAPSET: write 1 into the gate, return the OLD value, in one step
 (no other core can act between the read and the write).
 take gate: SWAPSET. old 0 -> you won (now it is 1). old 1 -> someone holds it,
 retry. release: write 0.

L8. Two cores GET at once with ONE gate over START. core3 SWAPSET -> old 0 -> in.
 core5 SWAPSET -> old 1 -> spins. core3 pops, releases (gate=0). core5 SWAPSET
 -> old 0 -> in. They take turns. With 8 cores, 7 spin while 1 works.

8 cores, 1 holds the gate. how many spin? 8-1 = ____ (7)

L9. Fix: give each core its own START and its own gate. Make an array of 8.
 kmem[k] for k=0..7, each = {gate, START}. core k uses kmem[k].
 Now core3 takes kmem[3].gate, core5 takes kmem[5].gate. Different cells. No
 spin (spin only happens on the SAME cell).

core3 and core5 GET at once. do they spin on each other? ____
 (no, different gate cells)

L10. FREE on core k: push to kmem[k].START , under kmem[k].gate.
 To know k, read a register holding this core's number. Call it COREID.
 trap: between reading COREID and taking the gate, the chip could move this
 code to another core, so COREID is stale. Block moves first: PUSHOFF before,
 POPOFF after (turns off the timer signal that moves code; the move only
 happens on that signal).

L11. GET on core k: pop kmem[k].START. if it is 0 (empty), the chunk is
 on another core's list. STEAL: scan kmem[0..7], find one with START != 0,
 pop one chunk from it, return it.

 kmem[0].START -> 0 (empty)
 kmem[3].START -> 0 (empty, this is me)
 kmem[5].START -> 0x80000 -> 0x82000 -> 0 (has chunks)
 core3 GET: my list empty -> scan -> kmem[5] has one -> pop 0x80000 from
 kmem[5] (under kmem[5].gate) -> return 0x80000.

core3 list empty, kmem[5] has 0x80000. core3 GET returns ____ (0x80000)
to pop from kmem[5], which gate do you hold? ____ (kmem[5].gate)

L12. STEAL deadlock. core0 empty steals from core1: holds gate0, wants gate1.
 core1 empty steals from core0: holds gate1, wants gate0. both wait. stuck.
 Fix: take the lower-index gate first, always.
 core0 wants {0,1}: takes gate0 then gate1.
 core1 wants {1,0}: ALSO takes gate0 first. so core1 waits on gate0 holding
 nothing. core0 finishes. no cycle.

core3 steals from core6. which gate first? ____ (gate3, lower index)
core6 steals from core3. which gate first? ____ (gate3, lower index)

================================================================================

L13. A disk is a row of 1024-byte blocks (scaled to 1024), numbered
 0,1,2,... Slow. Keep copies of recent blocks in memory = buffers. Say 30
 buffers. Each buffer holds: blockno, refcnt, 1024 data bytes.

L14. refcnt = a number: how many users hold this buffer now. 0 = nobody = may
 reuse. refcnt is NOT "matches disk". (clean-vs-disk is a separate fact.)

refcnt=0 means matches disk? ____ (no. means: no current users)

L15. refcnt++ is 3 steps (CH01: read cell, add, write cell). two cores both do
 refcnt++ on the same buffer:
 refcnt=2. coreA read 2. coreB read 2. coreA write 3. coreB write 3.
 should be 4, is 3. lost one. so even a cache hit needs a gate.

two ++ on refcnt=2 done right = 2+1+1 = ____ (4)
interleaved as above, result = ____ (3, wrong)

L16. Split the 30 buffers into buckets by block number. Pick 13 buckets.
 bucket of block n = n mod 13 (remainder after dividing by 13).
 each bucket = {gate, a small list of buffers}.

block 42: 42 = 3*13 + 3, so 42 mod 13 = ____ (3) -> bucket 3
block 99: 99 = 7*13 + 8, so 99 mod 13 = ____ (8) -> bucket 8

L17. core wanting block 42 takes gate of bucket 3. core wanting block 99 takes
 gate of bucket 8. different cells -> run at once (logic).

block 42 and block 99 at once. collide? ____ (no, bucket3 vs bucket8)

L18. GET block n (call it bget): bucket = n mod 13. take that gate. walk the
 bucket list (chain) for a buffer with blockno=n.
 HIT: found -> refcnt++ (under gate) -> return.
 MISS: not found -> need a free buffer (refcnt=0).

L19. MISS with no free buffer in this bucket: steal from another bucket. pick the
 buffer with refcnt=0 that was released longest ago. add a number TIMESTAMP to
 each buffer = the tick when refcnt last hit 0. scan all buckets, keep ONE
 running winner (smallest TIMESTAMP, refcnt=0). no sorting, no collecting.

 bucket0: buf{blk13,ref1,t=5} skip(ref!=0); buf{blk26,ref0,t=5} win t=5
 bucket2: buf{blk80,ref0,t=2} t=2<5 new win
 bucket5: buf{blk44,ref0,t=9} 9<2? no, keep
 winner = blk80, t=2.

winner after the scan = block ____ , t=____ (80, 2)

L20. move the winner (in bucket2) to the home bucket (bucket8 for blk99).
 two gates held: bucket2 and bucket8. lower index first : gate2 then
 gate8. unchain winner from bucket2 , set blockno=99, refcnt=1, valid=0,
 chain into bucket8. release both.

moving winner from bucket2 to bucket8, which gate first? ____ (gate2)

L21. valid=0 is the trap. the winner still holds block 80's 1024 data bytes. you
 renamed it blockno=99 but the bytes are still block 80's. valid=0 forces a
 fresh disk read of block 99 before any user reads the bytes. skip it -> user
 reads block 80 bytes labeled 99.

after rename, the 1024 data bytes are still block ____ 's (80)
valid set to ____ to force a re-read (0)

L22. re-check after locking (scanned without the gate). between scan and
 gate2, another core may have grabbed blk80 (refcnt now 1). after taking
 gate2, test refcnt=0 again. if not 0, the victim is taken -> rescan.

after locking gate2, blk80 refcnt=1. take it? ____ (no, rescan)

================================================================================
GRILL
chunk at 0x80000, next chunk start = 0x80000 + 4096 = ? (hex)
8 cores, 1 holds the one global gate. how many spin?
block 42 bucket = 42 mod 13 = ?
block 99 bucket = 99 mod 13 = ?
refcnt=2, two cores ++ interleaved (read,read,write,write). final = ?
core3 steals from core6. lower-index gate taken first = ?
winner block 80 (bucket2) moves to bucket8. first gate taken = ?
recycled buffer renamed to block 99, valid set to ? so disk re-read happens.

ANSWERS.
0x81000 (524288+4096 = 528384)
7
3 (42 = 3*13+3)
8 (99 = 7*13+8)
3 (lost update; correct is 4)
gate3
gate2
0
================================================================================
NAMES.
 chunk = a physical page (4096 bytes)
 START + free list = kmem.freelist (struct run *)
 gate-cell + SWAPSET = spinlock + amoswap (acquire/release)
 per-core kmem[k] = the lab's kmem[NCPU] split
 COREID = cpuid
 PUSHOFF/POPOFF = push_off/pop_off
 buffer = struct buf (bio.c)
 bucket = a hash bucket; n mod 13 = blockno % NBUCKET
 TIMESTAMP = ticks at brelse
 valid=0 = force bread to virtio_disk_rw from disk
================================================================================
