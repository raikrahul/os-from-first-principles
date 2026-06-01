# Lab 5 — Copy-on-Write Fork

## The problem: today's fork is wildly wasteful

### What fork does right now

```
fork()  in kernel/proc.c
  └─ uvmcopy(parent_tree, child_tree, parent_sz)

uvmcopy()  in kernel/vm.c
  for i = 0 ; i < sz ; i += 4096:
      pte   = walk(parent, i, 0)
      pa    = PTE2PA(*pte)
      flags = PTE_FLAGS(*pte)
      mem   = kalloc()                 // ← new 4096-unit chunk
      memmove(mem, pa, 4096)           // ← copy 4096 units
      mappages(child, i, 4096, mem, flags)
```

### Cost per chunk

```
  kalloc():    ~50 cycles (free-list pop)
  memmove():   4096 cycles (one cycle per unit, optimistic)
  mappages():  walk 3 descents, write 1 slot ≈ 30 cycles
  ────────────────────────────────────────────
  per chunk:   ≈ 4176 cycles
```

### Cost for a whole process

```
  parent has N chunks, sz = N × 4096

  fork cost ≈ N × 4176 cycles  +  N × kalloc

  examples:
    tiny xv6 shell  (sh.c ≈ 40 KB)    ⇒  N = 10    ⇒    40 K cycles
    medium server   (256 KB)          ⇒  N = 64    ⇒   267 K cycles
    real bash       (3 MB)            ⇒  N = 768   ⇒   3.2 M cycles
    java process    (300 MB)          ⇒  N = 76800 ⇒   320 M cycles
```

A `java` process forking takes hundreds of millions of cycles just to
copy its memory. That is **before** any of the child's work starts.

## The common case makes the waste worse

### Pattern 1: fork-then-exec

```
  user code:
      pid = fork();
      if (pid == 0) {
          exec("/bin/ls", argv);   // ← throws away ALL inherited memory
      }

  timeline:
    t=0    parent runs       sz=N×4096 chunks
    t=1    fork():           kalloc N chunks
                             memmove N × 4096 units                      (slow)
                             child tree mapped to brand-new copies
    t=2    child runs exec:  proc_freepagetable(child_tree)              (slow)
                             frees all N just-allocated chunks
                             load /bin/ls (different file) into NEW chunks
    ─────────────────────────────────────────────────────────────────────
    waste: every cycle spent in t=1's memmove was thrown out at t=2.
```

This is the dominant fork use-case in Unix. The shell forks-then-execs
for every command you type. Servers fork-then-exec for every connection.
`make` forks-then-execs for every rule.

### Pattern 2: fork-then-exit (rare but cheap to support)

```
  child does almost nothing, exits.
  parent's memory was copied for the child even though child never used it.
```

### Pattern 3: long-running fork (the only case where copying IS useful)

```
  parent forks. both run for a long time. both write to many chunks.
  copying up-front pays off because both ends end up needing separate copies.

  but: even here, only the SHARED-then-MODIFIED chunks needed copying.
  the chunks NEITHER side modifies stay identical forever — copying them
  was still waste.
```

## Visual: the waste

```
PARENT MEMORY (sz = 40 KB = 10 chunks)

  va=0x0000  ┌────────┐ P0  (code, never written)
             ├────────┤ P1  (code)
             ├────────┤ P2  (code)
             ├────────┤ P3  (rodata)
             ├────────┤ P4  (data — written sometimes)
             ├────────┤ P5  (bss)
             ├────────┤ P6  (heap)
             ├────────┤ P7  (heap)
             ├────────┤ P8  (stack)
  va=0x9000  └────────┘ P9  (stack)


TODAY'S FORK: copies ALL 10 chunks, every one of them.

  parent tree:  va=0..0x9000  →  P0..P9   (untouched)
  child tree:   va=0..0x9000  →  C0..C9   (10 brand-new chunks)

  P0 ≡ C0 (identical bytes)
  P1 ≡ C1
  ...
  P9 ≡ C9

  ⇒ 40 KB of DRAM allocated holding identical data to another 40 KB.


THEN: child calls exec("/bin/ls").

  ALL 10 child chunks freed.  10 brand-new chunks allocated for ls.

  Net effect of fork+exec:
     - kernel allocated 10 chunks, copied 40 KB
     - kernel immediately freed those same 10 chunks
     - cost: 40 K cycles + 10 kalloc + 10 kfree
     - benefit to user program: ZERO
```

## What COW changes

```
COW FORK: copy NOTHING. share. mark read-only.

  parent tree:  va=0..0x9000  →  P0..P9, R-only, COW flag set
  child tree:   va=0..0x9000  →  P0..P9, R-only, COW flag set
  refcount[P0] = 2
  refcount[P1] = 2
  ...
  refcount[P9] = 2

  ⇒ 0 chunks allocated. 0 units copied. constant time.


WRITE happens (parent writes byte at va=0x4abc, lives in P4):

  hardware:
      walks parent tree, finds PTE for va=0x4000 → P4
      PTE has R but no W ⇒ store-fault (scause = 15)
      sepc ← address of the offending instruction
      trap → usertrap

  usertrap handler (NEW code):
      pa = PTE2PA(*pte)
      if refcount[pa] > 1:
          newpa = kalloc()
          memmove(newpa, pa, 4096)
          *pte = PA2PTE(newpa) | flags_with_W | clear_COW
          refcount[pa] -= 1
      else:
          *pte |= PTE_W
          *pte &= ~PTE_COW
      sfence_vma()   // flush TLB for this VA
      return        // re-executes the offending instruction

  result:
      parent tree:  va=0x4000 → N4 (new chunk), RW
      child tree:   va=0x4000 → P4, R-only (still COW, refcount=1 now)
      bytes copied so far: 4096 (only for P4)


cost comparison for fork+exec:

  today's fork:                   COW fork:
    10 × 4096 = 40 K cycles         0 cycles
    + 10 kalloc                     + 0 kalloc
  then exec frees all 10            then exec frees nothing (refcount drops
                                                            to 1, frees only
                                                            what was unique)

  fork+exec speedup:  ~40× to ~1000× depending on N.
  real-world impact: bash startup, make build trees, server accept loops.
```

## Pieces to build

```
1. refcount table over physical chunks
   in kalloc.c:
     static struct {
         struct spinlock lock;
         int count[PHYSTOP / PGSIZE];
     } ref;
   helpers: ref_inc(pa), ref_dec(pa), ref_get(pa)

2. uvmcopy rewrite
   in vm.c:
     for each chunk in parent:
       clear PTE_W in parent's PTE
       set PTE_COW in parent's PTE
       install same pa in child's tree with same R / no-W / COW flags
       ref_inc(pa)

3. store-fault handler
   in trap.c usertrap:
     if scause == 15:
         handle_cow_fault(p->pagetable, stval)

4. handle_cow_fault
   in vm.c (new function):
     pte = walk(tree, va, 0)
     pa  = PTE2PA(*pte)
     if (*pte & PTE_COW) == 0 ⇒ real fault, kill
     if ref_get(pa) > 1:
         newpa = kalloc()
         memmove(newpa, pa, 4096)
         *pte = PA2PTE(newpa) | (PTE_FLAGS(*pte) & ~PTE_COW) | PTE_W
         ref_dec(pa)
     else:
         *pte |= PTE_W
         *pte &= ~PTE_COW
     sfence_vma()

5. copyout (vm.c)
   kernel-side writes don't go through hardware fault.
   before memcpy into user chunk: check + resolve COW manually.

6. kfree (kalloc.c)
   only put chunk back on free-list when refcount drops to 0.
```

## PTE bit budget

```
RISC-V Sv39 PTE layout (low end):

  bit 0  V    valid
  bit 1  R    readable
  bit 2  W    writable
  bit 3  X    executable
  bit 4  U    user-accessible
  bit 5  G    global
  bit 6  A    accessed (hardware sets)
  bit 7  D    dirty (hardware sets)
  bit 8  RSW  reserved for software ←  COW lives here
  bit 9  RSW  reserved for software
  bit 10..53  physical chunk index

  #define PTE_COW (1L << 8)
```

## Gotchas

```
1. fork-time: must clear PTE_W AND keep PTE_R.
   forgetting to clear W ⇒ writes succeed without faulting ⇒ broken sharing.

2. copyout: kernel writes don't fault. must manually check PTE_COW.
   forgetting ⇒ kernel writes silently corrupt parent data.

3. refcount must be locked.
   two harts can fork the same parent's chunks concurrently ⇒ races.

4. refcount underflow check.
   if you kfree a chunk that's still shared, the receiver crashes later.
   defensive: panic if ref_dec is called on a chunk with count 0.

5. fault on a chunk that's NOT cow ⇒ real fault ⇒ kill the process.
   don't blindly alloc-and-copy on every store-fault.

6. sfence_vma after PTE change.
   without it, the hart's TLB still has the old R-only entry ⇒ next write
   on the same VA traps again on the same fault ⇒ infinite loop.

7. exec/kill paths must respect refcount.
   freeing a chunk in one tree must not kfree shared physical memory
   while other trees still arrow at it.
```

## Test target

```
make qemu
$ cowtest

expected: all three sub-tests pass:
  simple    — small fork, child writes, parent unchanged
  three     — three-deep fork chain
  file      — fork during file read, no double-free
```

## Full Trace: uvmcopy for 10-page fork

```
SETUP
  old  (parent root array) = 0x87fff000     ← 3 arrays already built
  new  (child root array)  = 0x87ffe000     ← mostly zeroes, TRAMPOLINE/TRAPFRAME at high slots
  sz   = 0xA000 (40960 = 10 pages)
  caller: proc.c kfork() line 277

PARENT'S EXISTING ARRAYS (built when parent was loaded by exec):
  root    @ 0x87fff000:  slot[0] = PA2PTE(0x87ffa000)|PTE_V
  arr_A   @ 0x87ffa000:  slot[0] = PA2PTE(0x87ffb000)|PTE_V
  arr_B   @ 0x87ffb000:  slot[0] = PA2PTE(0x87f00000)|R|W|U|V  (P0, code)
                         slot[1] = PA2PTE(0x87f01000)|R|W|U|V  (P1, code)
                         slot[2] = PA2PTE(0x87f02000)|R|W|U|V  (P2, code)
                         slot[3] = PA2PTE(0x87f03000)|R|W|U|V  (P3, rodata)
                         slot[4] = PA2PTE(0x87f04000)|R|W|U|V  (P4, data)
                         slot[5] = PA2PTE(0x87f05000)|R|W|U|V  (P5, bss)
                         slot[6] = PA2PTE(0x87f06000)|R|W|U|V  (P6, heap)
                         slot[7] = PA2PTE(0x87f07000)|R|W|U|V  (P7, heap)
                         slot[8] = PA2PTE(0x87f08000)|R|W|U|V  (P8, stack)
                         slot[9] = PA2PTE(0x87f09000)|R|W|U|V  (P9, stack)

CHILD'S ROOT @ 0x87ffe000:  slot[0] = 0x0  (no user mappings yet)

FREELIST WILL RETURN (in order):
  C0=0x87f10000  C1=0x87f11000  C2=0x87f12000  C3=0x87f13000  C4=0x87f14000
  C5=0x87f15000  C6=0x87f16000  C7=0x87f17000  C8=0x87f18000  C9=0x87f19000
  child_A=0x87ffc000   child_B=0x87ffd000  (intermediate arrays)

PX MACRO FOR ALL VAs IN 0x0000..0x9000:
  PX(2, any) = 0    PX(1, any) = 0    PX(0, va) = va >> 12
  ∴ all 10 pages share the same path through arrays, differ only at leaf slot index


════════════════════════════ ITERATION i=0x0000 (page 0) ════════════════════════════

#1  CALL     uvmcopy(0x87fff000, 0x87ffe000, 0xA000)         i=0x0000, i<0xA000 ✓                                    caller=proc.c:277  cur=vm.c:304
#2  CALL     walk(old=0x87fff000, va=0x0000, alloc=0)         find parent PTE for va 0x0000                            caller=vm.c:305    cur=vm.c:98
#3  EXEC     level=2  pte=&old[0]  *pte=valid                pagetable = PTE2PA(*pte) = 0x87ffa000                    cur=vm.c:104-106
#4  EXEC     level=1  pte=&0x87ffa000[0]  *pte=valid          pagetable = PTE2PA(*pte) = 0x87ffb000                    cur=vm.c:104-106
#5  RETURN   return &0x87ffb000[0]                            pointer to parent leaf slot for va 0x0000                 vm.c:114 → vm.c:305
#6  RESUME   pte=&arr_B[0] non-null, *pte&PTE_V==1           skip both continues                                      cur=vm.c:305-308
#7  EXEC     pa = PTE2PA(*pte) = 0x87f00000                  parent's physical frame for page 0                        cur=vm.c:309
#8  EXEC     flags = PTE_FLAGS(*pte) = R|W|U|V (0x17)        permission bits extracted                                 cur=vm.c:310
#9  CALL     mem = kalloc() = 0x87f10000                      fresh 4096-byte frame from freelist                       cur=vm.c:311
#10 EXEC     memmove(0x87f10000, 0x87f00000, 4096)            RAM[0x87f00000..fff] → RAM[0x87f10000..fff]  COPY DONE    cur=vm.c:313

    *** 2 copies of page 0 in RAM now: 0x87f00000 (parent) and 0x87f10000 (child). No PTE points to 0x87f10000 yet ***

#11 CALL     mappages(0x87ffe000, 0x0000, 4096, 0x87f10000, 0x17)   a=0x0000 last=0x0000                              caller=vm.c:314  cur=vm.c:146
#12 CALL     walk(new=0x87ffe000, va=0x0000, alloc=1)               find/create leaf slot in child's tree               caller=vm.c:163  cur=vm.c:98
#13 EXEC     level=2  pte=&new[0]  *pte=0x0 EMPTY                  alloc=1 → must kalloc                               cur=vm.c:104,107-108
#14 CALL     kalloc() inside walk = 0x87ffc000                      EXTRA ALLOC #1: child's second array                cur=vm.c:108
#15 EXEC     memset(0x87ffc000, 0, 4096)                            512 slots zeroed                                    cur=vm.c:110
#16 EXEC     *pte = PA2PTE(0x87ffc000)|PTE_V                       new[0] now links to child_A @ 0x87ffc000             cur=vm.c:111
#17 EXEC     level=1  pte=&0x87ffc000[0]  *pte=0x0 EMPTY           alloc=1 → must kalloc again                          cur=vm.c:104,107-108
#18 CALL     kalloc() inside walk = 0x87ffd000                      EXTRA ALLOC #2: child's third array                  cur=vm.c:108
#19 EXEC     memset(0x87ffd000, 0, 4096)                            512 slots zeroed                                    cur=vm.c:110
#20 EXEC     *pte = PA2PTE(0x87ffd000)|PTE_V                       child_A[0] now links to child_B @ 0x87ffd000         cur=vm.c:111
#21 RETURN   return &0x87ffd000[0]                                  leaf slot in child's third array                     vm.c:114 → vm.c:163
#22 RESUME   pte=&child_B[0] non-null  *pte&PTE_V==0 no panic      slot empty, safe to write                            cur=vm.c:163-166
#23 EXEC     *child_B[0] = PA2PTE(0x87f10000)|R|W|U|V              THE WRITE: va 0x0000 → pa 0x87f10000 in child tree   cur=vm.c:167
#24 EXEC     a==last (0x0000==0x0000) → break                      1 page mapped, done                                  cur=vm.c:168-169
#25 RETURN   mappages returns 0                                     child va 0x0000 → 0x87f10000 established              vm.c:173 → vm.c:314

    CHILD TREE STATE AFTER PAGE 0:
      new[0] → child_A @ 0x87ffc000 → child_B @ 0x87ffd000
      child_B[0] = 0x87f10000|R|W|U|V


════════════════════════════ ITERATION i=0x1000 (page 1) ════════════════════════════

#26 EXEC     i += 0x1000 → i=0x1000, i<0xA000 ✓                                                                       cur=vm.c:304
#27 CALL     walk(old=0x87fff000, 0x1000, 0)                  old[0]→0x87ffa000  arr_A[0]→0x87ffb000                   caller=vm.c:305
#28 RETURN   return &arr_B[1]                                 *arr_B[1] = PA2PTE(0x87f01000)|R|W|U|V                    vm.c:114 → vm.c:305
#29 EXEC     pa=0x87f01000  flags=0x17                        parent page 1 address extracted                           cur=vm.c:309-310
#30 CALL     mem=kalloc()=0x87f11000                          memmove(0x87f11000, 0x87f01000, 4096) COPY DONE           cur=vm.c:311-313
#31 CALL     mappages(0x87ffe000, 0x1000, 4096, 0x87f11000, 0x17)                                                      caller=vm.c:314
#32 CALL     walk(new, 0x1000, 1)                             new[0]→child_A  child_A[0]→child_B  NO NEW ALLOCS         caller=vm.c:163
#33 RETURN   return &child_B[1]  *child_B[1]=0x0 empty                                                                 vm.c:114 → vm.c:163
#34 EXEC     *child_B[1] = PA2PTE(0x87f11000)|R|W|U|V        THE WRITE: va 0x1000 → 0x87f11000                         cur=vm.c:167
#35 RETURN   mappages returns 0                                                                                         vm.c:173 → vm.c:314


════════════════════════════ ITERATION i=0x2000 (page 2) ════════════════════════════

#36 EXEC     i=0x2000, i<0xA000 ✓                                                                                      cur=vm.c:304
#37 CALL     walk(old, 0x2000, 0) → &arr_B[2]                pa=0x87f02000  flags=0x17                                 vm.c:305-310
#38 CALL     mem=kalloc()=0x87f12000                          memmove(0x87f12000, 0x87f02000, 4096) COPY DONE           vm.c:311-313
#39 CALL     mappages → walk(new, 0x2000, 1) → &child_B[2]   NO NEW ALLOCS, path exists                                vm.c:314,163
#40 EXEC     *child_B[2] = PA2PTE(0x87f12000)|R|W|U|V        THE WRITE: va 0x2000 → 0x87f12000                         vm.c:167
#41 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x3000 (page 3) ════════════════════════════

#42 EXEC     i=0x3000, i<0xA000 ✓                                                                                      vm.c:304
#43 CALL     walk(old, 0x3000, 0) → &arr_B[3]                pa=0x87f03000  flags=0x17                                 vm.c:305-310
#44 CALL     mem=kalloc()=0x87f13000                          memmove(0x87f13000, 0x87f03000, 4096) COPY DONE           vm.c:311-313
#45 CALL     mappages → walk(new, 0x3000, 1) → &child_B[3]   NO NEW ALLOCS                                             vm.c:314,163
#46 EXEC     *child_B[3] = PA2PTE(0x87f13000)|R|W|U|V        THE WRITE: va 0x3000 → 0x87f13000                         vm.c:167
#47 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x4000 (page 4) ════════════════════════════

#48 EXEC     i=0x4000, i<0xA000 ✓                                                                                      vm.c:304
#49 CALL     walk(old, 0x4000, 0) → &arr_B[4]                pa=0x87f04000  flags=0x17                                 vm.c:305-310
#50 CALL     mem=kalloc()=0x87f14000                          memmove(0x87f14000, 0x87f04000, 4096) COPY DONE           vm.c:311-313
#51 CALL     mappages → walk(new, 0x4000, 1) → &child_B[4]   NO NEW ALLOCS                                             vm.c:314,163
#52 EXEC     *child_B[4] = PA2PTE(0x87f14000)|R|W|U|V        THE WRITE: va 0x4000 → 0x87f14000                         vm.c:167
#53 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x5000 (page 5) ════════════════════════════

#54 EXEC     i=0x5000, i<0xA000 ✓                                                                                      vm.c:304
#55 CALL     walk(old, 0x5000, 0) → &arr_B[5]                pa=0x87f05000  flags=0x17                                 vm.c:305-310
#56 CALL     mem=kalloc()=0x87f15000                          memmove(0x87f15000, 0x87f05000, 4096) COPY DONE           vm.c:311-313
#57 CALL     mappages → walk(new, 0x5000, 1) → &child_B[5]   NO NEW ALLOCS                                             vm.c:314,163
#58 EXEC     *child_B[5] = PA2PTE(0x87f15000)|R|W|U|V        THE WRITE: va 0x5000 → 0x87f15000                         vm.c:167
#59 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x6000 (page 6) ════════════════════════════

#60 EXEC     i=0x6000, i<0xA000 ✓                                                                                      vm.c:304
#61 CALL     walk(old, 0x6000, 0) → &arr_B[6]                pa=0x87f06000  flags=0x17                                 vm.c:305-310
#62 CALL     mem=kalloc()=0x87f16000                          memmove(0x87f16000, 0x87f06000, 4096) COPY DONE           vm.c:311-313
#63 CALL     mappages → walk(new, 0x6000, 1) → &child_B[6]   NO NEW ALLOCS                                             vm.c:314,163
#64 EXEC     *child_B[6] = PA2PTE(0x87f16000)|R|W|U|V        THE WRITE: va 0x6000 → 0x87f16000                         vm.c:167
#65 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x7000 (page 7) ════════════════════════════

#66 EXEC     i=0x7000, i<0xA000 ✓                                                                                      vm.c:304
#67 CALL     walk(old, 0x7000, 0) → &arr_B[7]                pa=0x87f07000  flags=0x17                                 vm.c:305-310
#68 CALL     mem=kalloc()=0x87f17000                          memmove(0x87f17000, 0x87f07000, 4096) COPY DONE           vm.c:311-313
#69 CALL     mappages → walk(new, 0x7000, 1) → &child_B[7]   NO NEW ALLOCS                                             vm.c:314,163
#70 EXEC     *child_B[7] = PA2PTE(0x87f17000)|R|W|U|V        THE WRITE: va 0x7000 → 0x87f17000                         vm.c:167
#71 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x8000 (page 8) ════════════════════════════

#72 EXEC     i=0x8000, i<0xA000 ✓                                                                                      vm.c:304
#73 CALL     walk(old, 0x8000, 0) → &arr_B[8]                pa=0x87f08000  flags=0x17                                 vm.c:305-310
#74 CALL     mem=kalloc()=0x87f18000                          memmove(0x87f18000, 0x87f08000, 4096) COPY DONE           vm.c:311-313
#75 CALL     mappages → walk(new, 0x8000, 1) → &child_B[8]   NO NEW ALLOCS                                             vm.c:314,163
#76 EXEC     *child_B[8] = PA2PTE(0x87f18000)|R|W|U|V        THE WRITE: va 0x8000 → 0x87f18000                         vm.c:167
#77 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ ITERATION i=0x9000 (page 9, LAST) ════════════════════════════

#78 EXEC     i=0x9000, i<0xA000 ✓                                                                                      vm.c:304
#79 CALL     walk(old, 0x9000, 0) → &arr_B[9]                pa=0x87f09000  flags=0x17                                 vm.c:305-310
#80 CALL     mem=kalloc()=0x87f19000                          memmove(0x87f19000, 0x87f09000, 4096) COPY DONE           vm.c:311-313
#81 CALL     mappages → walk(new, 0x9000, 1) → &child_B[9]   NO NEW ALLOCS                                             vm.c:314,163
#82 EXEC     *child_B[9] = PA2PTE(0x87f19000)|R|W|U|V        THE WRITE: va 0x9000 → 0x87f19000                         vm.c:167
#83 RETURN   mappages returns 0                                                                                         vm.c:173


════════════════════════════ EXIT ════════════════════════════

#84 EXEC     i += 0x1000 → i=0xA000, i<0xA000 ✗ → loop ends                                                           vm.c:304
#85 RETURN   uvmcopy returns 0 (success)                                                                                vm.c:319 → proc.c:277


════════════════════════════ FINAL STATE ════════════════════════════

PARENT TREE (unchanged):
  root @ 0x87fff000 → arr_A @ 0x87ffa000 → arr_B @ 0x87ffb000
  arr_B[0..9] → P0..P9 @ 0x87f00000..0x87f09000

CHILD TREE (fully built):
  new  @ 0x87ffe000 → child_A @ 0x87ffc000 → child_B @ 0x87ffd000
  child_B[0] → C0 @ 0x87f10000    (copy of P0)
  child_B[1] → C1 @ 0x87f11000    (copy of P1)
  child_B[2] → C2 @ 0x87f12000    (copy of P2)
  child_B[3] → C3 @ 0x87f13000    (copy of P3)
  child_B[4] → C4 @ 0x87f14000    (copy of P4)
  child_B[5] → C5 @ 0x87f15000    (copy of P5)
  child_B[6] → C6 @ 0x87f16000    (copy of P6)
  child_B[7] → C7 @ 0x87f17000    (copy of P7)
  child_B[8] → C8 @ 0x87f18000    (copy of P8)
  child_B[9] → C9 @ 0x87f19000    (copy of P9)

ALLOCATION TALLY:
  10 data frames  (C0..C9)          = 10 × 4096 = 40960 bytes
  2  intermediate arrays (child_A, child_B) = 2 × 4096 = 8192 bytes
  1  root array (new, from proc_pagetable)  = 1 × 4096 = 4096 bytes
  ─────────────────────────────────────────────────────────────────
  TOTAL: 13 kallocs for child     =  53248 bytes
  TOTAL memmove:  10 × 4096       =  40960 bytes copied

  every byte of parent data duplicated in RAM.
  if child calls exec() next → all 13 pages freed → 53248 bytes wasted.
```
