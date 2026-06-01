# Lab 3 — The Lookup Tree (3 levels, 4096-byte chunks)

## What it is

A 3-level tree of 4096-byte chunks that the silicon-equivalent reads to convert
the user-program's 8-byte place-name into the where-the-bytes-actually-live
number. One tree per task.

## Structure

```
ONE TASK'S TREE — 3 levels of chunks, ending at the FINAL chunks that hold the user's actual bytes:


LEVEL 0 (top)         [4096 B chunk, 512 slots]
                       satp's value points here
                          /            |            \
                        slot 0       slot 5        slot 511
                        (used)       (used)        (used)
                          |            |              |
                          v            v              v
LEVEL 1 (middle)      [chunk]      [chunk]        [chunk]      (one per used top slot)
                        / \           |               |
                    slot 0 slot 7   slot 3        slot 100
                     (used)(used)   (used)         (used)
                        |    \         \             |
                        v     v         v            v
LEVEL 2 (bottom)    [chunk] [chunk]  [chunk]     [chunk]       (one per used middle slot)
                       |       |         \           |
                    slot 4  slot 19    slot 200   slot 0
                    (used)  (used)     (used)     (used)
                       |       |         |           |
                       v       v         v           v
FINAL DATA          [4096 B] [4096 B] [4096 B]    [4096 B]     (raw bytes — user code,
chunk                                                            stack, heap, etc.
                                                                 NOT slots — bytes)


Every "used" slot at level 0/1 points to a 4096-byte chunk at the next level down.
Every "used" slot at level 2 points to a 4096-byte FINAL chunk holding bytes.

vmprint's job: visit every USED slot at every level. Print one line per visit.
  - Level 0 slot prints with prefix " ..".
  - Level 1 slot prints with prefix " .. ..".
  - Level 2 slot prints with prefix " .. .. ..".
  - Skip slots whose "used" bit is 0.
  - When at level 0 or 1, descend into the chunk the slot names. At level 2, just print.
```

## Slot packing

Each chunk in the tree: 4096 bytes = 512 slots × 8 bytes per slot. The 8-byte
slot must carry both the name-of-next-chunk AND flag bits — together that's
more than 8 bytes naturally, so the engineers exploit alignment.

Since every chunk's place-number is 4096-aligned, the low 12 binary positions of
the place-number are always 0. The slot drops those 12 zeros (recovers 12
positions), leaving room in the low 10 positions for flag bits.

```
A slot's 8 bytes laid out:

  +-------+----------------------------------------+-----------+
  | rsvd  |   chunk-name top portion               |  flags    |
  | (10)  |          (44 positions)                |   (10)    |
  +-------+----------------------------------------+-----------+
                                                   |
                                                   v
                                          V  R  W  X  U  (low 5)
```

## Flag bit meanings (kernel/riscv.h)

| Macro   | Position | Meaning                                  |
|---------|----------|------------------------------------------|
| PTE_V   | bit 0    | Used / valid — must be 1 or slot is skipped |
| PTE_R   | bit 1    | Readable                                 |
| PTE_W   | bit 2    | Writable                                 |
| PTE_X   | bit 3    | Fetch-and-execute allowed                |
| PTE_U   | bit 4    | User-program may access (else privileged-only) |

## Useful macros (kernel/riscv.h)

| Macro          | What it does                                              |
|----------------|-----------------------------------------------------------|
| PTE2PA(pte)    | Strip flags + restore 12 zeros → clean chunk-name. `(pte >> 10) << 12` |
| PTE_FLAGS(pte) | Get just the low 10 flag positions. `pte & 0x3FF`          |
| PX(level, va)  | Get the 9-bit slot index for `level` (0=bottom, 1=middle, 2=top) from a user-number. `(va >> (12 + 9*level)) & 0x1FF` |
| PGSIZE         | 4096 — chunk size                                         |
| PGSHIFT        | 12 — number of low positions of a place-number that are the within-chunk offset |
| PXMASK         | 0x1FF — 9-bit mask for slot index                         |
| PXSHIFT(level) | 12 + 9*level                                              |

## Concrete pack/unpack example

```
A chunk lives at place 0x87f6a000. (4096-aligned: low 12 binary = 0.)

To pack 0x87f6a000 plus flag bits V=1,R=1 (=0x03) into a slot:
   chunk-name's top 52 positions = 0x87f6a000 >> 12 = 0x87f6a
   shift back left by 10 to leave room for flags    = 0x21fda800
   OR in flags 0x03                                = 0x21fda803
   slot value stored: 0x21fda803

To unpack back: PTE2PA(0x21fda803) =
   step 1: 0x21fda803 >> 10 = 0x87f6a
   step 2: 0x87f6a << 12    = 0x87f6a000      <- clean chunk-name back

Matches lab spec output: "pte 0x...21fda801 pa 0x...87f6a000"
```

## How `pagetable_t` is used as an array

`pagetable_t = uint64 *` — an 8-unit place-name (one slot wide). When used with
the indexing operator, it's treated as the start of an array of uint64 slots.

```
Local declaration:  pagetable_t pagetable = (pagetable_t) kalloc();

   Suppose kalloc returned the place-name 0x87f6e000.

   stack frame             working memory at 0x87f6e000
   ┌──────────────┐        (one 4096-unit chunk; 512 slots × 8 units each)
   │ pagetable    │        ┌────────────────────────────────────────────┐
   │ = 0x87f6e000 │ ──────→│ slot 0  │ slot 1  │ slot 2 │ ... │ slot511│
   │ (8 units)    │        │ (8 u)   │ (8 u)   │ (8 u)  │     │ (8 u)  │
   └──────────────┘        └────────────────────────────────────────────┘
                            ↑          ↑          ↑               ↑
                            0x87f6e000 0x87f6e008 0x87f6e010      0x87f6effc+4
```

### Indexing forms

```c
pagetable[i]            // reads the VALUE at slot i
&pagetable[i]           // PLACE-NAME of slot i (for writing)
pagetable + i           // PLACE-NAME of slot i (same thing, no & needed)
&(pagetable + i)        // SYNTAX ERROR — can't take & of an rvalue
```

`pagetable[i]` is equivalent to `*(pagetable + i)` (dereference the i-th slot).
`&pagetable[i]` cancels the dereference, leaving just `pagetable + i`.

### Why walk returns `&pagetable[PX(level, va)]`

Walk's caller (`mappages`) needs to WRITE the final packed mapping into the
slot. To write, the caller needs the place-name, not the value. Hence walk
returns a `pte_t *` (pointer to the slot), not a `pte_t` (the value).

```c
pte_t *slot = walk(kpgtbl, UART0, 1);
*slot = PA2PTE(UART0) | PTE_R | PTE_W | PTE_V;   // <- writing through the place-name
```

## Slot's 64 positions broken down

```
position:  63 ... 54   53 ............ 10   9 ........ 0
           [reserved]  [chunk-name upper 44] [flags 10]
              10          44                    10
```

- Positions 0..9 (10 positions): flag markers — V, R, W, X, U, plus A, D, G, plus 2 spare.
- Positions 10..53 (44 positions): the chunk-name's upper portion (stored).
- Positions 54..63 (10 positions): reserved by spec, must be zero.

A full chunk-name is 56 positions wide. Of those 56:
- Lowest 12 not stored — every chunk starts at a multiple of 4096, so those 12 are guaranteed zero and recoverable by `<< 12`.
- Remaining 44 stored at positions 10..53 of the slot.

PTE2PA extracts the 44 (`>> 10`) and adds the 12 zeros back (`<< 12`).

## Difference vs satp

`satp` stores a chunk-name without packing — no flag bits in the low 10. The
kernel typecasts satp's value directly to `pagetable_t`. The packing trick only
happens INSIDE slots of the tree, not in satp.

## Combined tree + macros diagram

```
A USER-NUMBER N (8 bytes; 39 useful binary positions):
  ┌──────────┬──────────┬──────────┬─────────────────┐
  │ PX(2,N)  │ PX(1,N)  │ PX(0,N)  │  N & 0xfff      │
  │  9 pos   │  9 pos   │  9 pos   │  12 pos         │
  │  (top    │  (middle │  (bottom │  (within-final  │
  │   slot)  │   slot)  │   slot)  │   chunk offset) │
  └────┬─────┴─────┬────┴─────┬────┴──────┬──────────┘
       │           │          │           │
       ▼           │          │           │
LEVEL 0 (top)   [chunk, place = SATP value]
                512 slots, each 8 bytes
                ┌─────────────────────────────────────┐
                │ slot 0                              │
                │ slot 1                              │
                │ ...                                 │
pgtbl[PX(2,N)]──→ slot K  ─── skip if !(slot & PTE_V)│
                │                                    │
                │              PTE2PA(slot) ─────────┼─→ next chunk's place
                │              PTE_FLAGS(slot) ──────┼─→ R/W/X/U bits
                │ ...                                 │
                │ slot 511                            │
                └─────────────────────────────────────┘
                            │
                            ▼
LEVEL 1 (middle) [chunk, place = PTE2PA(top slot K)]
                 512 slots
                 ┌─────────────────────────────────┐
                 │ slot 0                          │
pgtbl[PX(1,N)] ──→ slot M  ─── PTE_V check        │
                 │                                 │
                 │           PTE2PA(slot) ─────────┼─→ next chunk's place
                 │ ...                             │
                 └─────────────────────────────────┘
                            │
                            ▼
LEVEL 2 (bottom) [chunk, place = PTE2PA(middle slot M)]
                 512 slots
                 ┌─────────────────────────────────┐
pgtbl[PX(0,N)] ──→ slot J  ─── PTE_V check        │
                 │                                 │
                 │           PTE2PA(slot) ─────────┼─→ FINAL CHUNK's place
                 │           PTE_FLAGS(slot) ──────┼─→ user-program's
                 │                                 │   R/W/X/U for these
                 │ ...                             │   bytes
                 └─────────────────────────────────┘
                            │
                            ▼
FINAL DATA       [4096 bytes — raw user bytes, no slots]
                 byte the user wanted = at  PTE2PA(bottom slot)  +  (N & 0xfff)


ROLE OF EACH MACRO IN ONE LINE:
  PX(level, N)     → pick WHICH slot to look at on a level (LOOKUP only)
  slot & PTE_V     → is this slot used? skip if 0
  PTE2PA(slot)     → strip flags + restore 12 zeros → next chunk's place
  PTE_FLAGS(slot)  → low 10 positions → R/W/X/U/V bits for permission checks

VMPRINT vs LOOKUP:
  - LOOKUP uses PX to pick ONE slot per level (3 reads total).
  - VMPRINT loops over all 512 slots per chunk, prints each used one.
```

## Task 2 — per-task privileged-mode tree

### Current state (before Task 2)

```
3 tasks running. Each has its OWN user-mode tree.
But all share ONE privileged-mode tree.

   Task A             Task B             Task C
   ┌────────┐         ┌────────┐         ┌────────┐
   │ user   │         │ user   │         │ user   │
   │ tree A │         │ tree B │         │ tree C │
   └────┬───┘         └────┬───┘         └────┬───┘
        │ when in user mode, satp = this task's user tree top
        │                  │                  │
        │                  │                  │
        │ (trap fires:                        │
        │  ecall, interrupt, etc.)            │
        │                  │                  │
        ▼                  ▼                  ▼
        └─────────────────┬─────────────────┘
                          │
                          ▼
         ┌─────────────────────────────────┐
         │   THE ONE SHARED                │
         │   PRIVILEGED-MODE TREE          │
         │   (named kernel_pagetable)      │
         │                                 │
         │   Holds mappings for:           │
         │     UART hardware               │
         │     VIRTIO hardware             │
         │     PLIC interrupt controller   │
         │     privileged code             │
         │     privileged data             │
         │     TRAMPOLINE                  │
         │     ALL N tasks' stacks         │
         └─────────────────────────────────┘
```

### After Task 2

```
Each task has TWO trees: user + its own privileged.

   Task A                  Task B                  Task C
   ┌────────┐ ┌────────┐   ┌────────┐ ┌────────┐   ┌────────┐ ┌────────┐
   │ user   │ │ priv   │   │ user   │ │ priv   │   │ user   │ │ priv   │
   │ tree A │ │ tree A │   │ tree B │ │ tree B │   │ tree C │ │ tree C │
   └────────┘ └────────┘   └────────┘ └────────┘   └────────┘ └────────┘

Each priv tree has the SAME hardware/code/data mappings as the global one
(copies of the TREE STRUCTURE, not the underlying chunks),
PLUS only this task's own stack (not the other tasks').
```

### The problem solved

Without per-task priv tree, privileged code can't dereference a user-given
number directly — the user mapping isn't in the shared privileged tree.
Functions like `copyin(user_addr, ...)` must manually step through the user
tree slot-by-slot (`walkaddr` in `vm.c`) to translate. Slow and bug-prone.

With per-task priv tree, Task 3 of the lab installs the user mappings INTO
the priv tree too. Then `copyin` becomes a plain `memmove`.

## Walk first-iteration state trace (UART0 example)

```
ENTRY STATE:
  walk(kpgtbl, 0x10000000, 1)
    pagetable = 0x87f6e000  (kpgtbl's place-name)
    va        = 0x10000000
    alloc     = 1

STEP 1: Compute slot index
  PX(2, va) = (0x10000000 >> 30) & 0x1FF = 64

  chunk at 0x87f6e000:
  ┌──────┬──────┬──────┬──────┬──────┬─────────┬──────┐
  │ slot0│ slot1│ ...  │ ...  │slot63│ slot 64 │ ...  │
  │  0   │  0   │  0   │  0   │  0   │   0     │  0   │
  └──────┴──────┴──────┴──────┴──────┴─────────┴──────┘

STEP 2: pte = &pagetable[64]
  pte = 0x87f6e000 + 64*8 = 0x87f6e200
  *pte = 0 (slot's content)

STEP 3: Test *pte & PTE_V
  0 & PTE_V = 0  → false  → ELSE branch
  (Equivalent to *pte == 0 for a fresh chunk. Convention uses & PTE_V
   to robustly check just the V flag.)

STEP 4: pagetable = (pde_t*) kalloc()  (suppose returns 0x87f6a000)
  Local `pagetable` reassigned to 0x87f6a000 (NEW middle chunk).
  `pte` still points at top chunk's slot 64.

STEP 5: memset(pagetable, 0, PGSIZE)
  New middle chunk at 0x87f6a000 — all 4096 units zeroed.

STEP 6: *pte = PA2PTE(pagetable) | PTE_V
  PA2PTE(0x87f6a000) = (0x87f6a000 >> 12) << 10 = 0x21fda800
  *pte = 0x21fda801
  
  Top chunk's slot 64 now packs the middle chunk's place-name + PTE_V.

END OF ITERATION 1:
  pagetable = 0x87f6a000 (middle chunk)
  Loop continues with level=1: same dance for middle slot 128 → alloc bottom chunk.

AFTER LOOP (level becomes 0):
  return &pagetable[PX(0, 0x10000000)] = &bottom[0]
  
The caller (mappages) writes the FINAL mapping into bottom[0]:
  *returned = (UART0 >> 12 << 10) | PTE_R | PTE_W | PTE_V
```

## PA2PTE — packing a chunk-name into a slot

`PA2PTE(pa) = ((pa >> 12) << 10)`. Inverse of PTE2PA.

Targets positions 10..53 of the slot (the slot's chunk-name field).

```
Source chunk-name 0x87f6a000 in 64 positions:
  position:  63 ........ 32  31 ........ 12  11 ........ 0
  value:     0...........0    0x87f6a         0...........0
                              (identifier)    (alignment zeros)

Step 1:  >> 12       drops alignment zeros, identifier at bottom
Step 2:  << 10       positions identifier into slot's chunk-name field (positions 10..29)

Result 0x21fda800:
  position:  63 ........ 30  29 .... 10   9 ........ 0
  value:     0...........0    0x87f6a       0...........0
                                ↑              ↑
                                slot's         flag field
                                chunk-name     (empty, waiting for OR)
                                field

After caller's | PTE_V → 0x21fda801, ready to write into a slot.
```

## Paging — Comprehensive Overview (formal terminology)

### Definition

Paging is a memory management technique where:
1. The CPU's view of memory is divided into fixed-size **pages** (typically 4 KB).
2. Physical memory (DRAM) is divided into **page frames** of the same size.
3. A per-process **page table** maps each virtual page to a physical frame.
4. On every memory access, the **MMU** consults the page table to translate VA → PA.
5. The translation also carries permission bits (R/W/X/U), enforced by the MMU.

### Why Paging Exists

1. **Memory isolation.** Each process gets its own page table. Process A's
   VA 0x1000 maps to a different physical page than B's 0x1000.
2. **Memory protection.** PTEs carry R/W/X/U bits. MMU faults on permission
   violation — stops buffer overflows from executing injected shellcode.
3. **Sparse virtual address spaces.** 64-bit processes have huge logical
   spaces but only mappings for used regions; multi-level page tables
   make this affordable.
4. **Demand paging.** Pages can be marked not-present; first access faults
   and the kernel materializes the page (zero / swap-in / file-read).
5. **Memory sharing.** Two page tables can map the same physical frame
   (shared libraries; COW fork).
6. **Memory relocation.** Physical memory may be fragmented; each process
   sees a virtually contiguous layout.

### Hardware Components

- **MMU** — translates VAs to PAs on every load/store. Walks page tables in
  hardware on TLB miss.
- **TLB (Translation Lookaside Buffer)** — 64-1024 entry cache of recent
  translations. Hit = 1 cycle. Miss = full page-table walk (3-5 memory loads).
- **CR3 (x86) / satp (RISC-V) / TTBR0_EL1 (ARM64)** — control register
  holding the physical address of the current process's root page table.
  Context switch writes a new value here.
- **Page-fault exception** — taken when MMU can't translate. CPU saves the
  faulting VA in stval (RISC-V) / CR2 (x86) for the handler.

### Multi-Level Page Tables

A flat 39-bit VA space with 4 KB pages would need 2^27 × 8 = 1 GB of table.
Solution: a radix tree of page tables.

- Sv39 (RISC-V) — 3 levels.
- x86_64 — 4 levels (PML4 → PDPT → PD → PT).
- x86_64 LA57 — 5 levels.

Each level: 9 bits of VA index a 512-entry table. Only allocate tables for
mapped ranges. Empty branches → no table allocation.

Each PTE: 64 bits = (10 reserved) + (44 bits physical frame number) +
(10 bits flags including V, R, W, X, U, A, D, G).

### Page Faults

When the MMU can't translate:
1. CPU saves VA in stval / CR2.
2. Traps to the kernel's page-fault handler.
3. Handler decides:
   - **Demand-page anon:** kalloc a fresh page, install PTE, return.
   - **Demand-page file:** read from backing file, install PTE.
   - **COW fault:** kalloc, copy original, install with PTE_W.
   - **Stack growth:** extend stack mapping if VA is just below it.
   - **Swap-in:** read from swap, install PTE.
   - **Illegal access:** send SIGSEGV.

### Real Systems

- **Linux** — each task_struct → mm_struct → pgd. Kernel runs against
  current task's pgd. Kernel mappings in upper half of every pgd. KPTI
  (2018) added a separate user pgd for Meltdown mitigation.
- **xv6** — each process has p->pagetable (user). Vanilla xv6 has separate
  kernel_pagetable. Lab 3 Task 2 adds per-process kernel pagetable.
- **macOS / FreeBSD** — pmap structure per process.

### Performance Considerations

- **TLB pressure** — every context switch flushes TLB (unless PCID/ASID).
  Warmup costs hundreds of cycles per page.
- **Hugepages** — 2 MB or 1 GB pages. One TLB entry covers more.
- **NUMA** — pages on remote nodes pay extra cycles per access.

## Walk loop — what changes each iteration

Three things move in lockstep per iter:
- `level` — loop counter, going 2 → 1 → (exit).
- `pagetable` — the chunk we're looking inside (reassigned at end of each iter
  to the next chunk down).
- `PX(level, va)` — slot index within the current chunk, recomputed each iter
  because `level` changes.

```
Iter 1 (level=2):
  pagetable = top (input from caller)
  PX(2, va) = top index (positions 30..38 of va)
  pte = &top[PX(2, va)]
  ... else branch (slot empty) ... → pagetable = middle (newly allocated)

Iter 2 (level=1):
  pagetable = middle (changed last iter)
  PX(1, va) = middle index (positions 21..29 of va)
  pte = &middle[PX(1, va)]
  ... else branch ... → pagetable = bottom (newly allocated)

After loop:
  pagetable = bottom
  return &pagetable[PX(0, va)] = &bottom[PX(0, va)]
                                  (bottom index = positions 12..20 of va)
```

## What walk returns

The PLACE-NAME of the bottom slot (a `pte_t *` = 8-unit number), NOT the value
stored there. The bottom chunk was just allocated and zeroed by walk, so its
contents are all 0. The caller (`mappages`) uses the place-name to WRITE the
final mapping there.

## mappages — the loop that calls walk

```c
mappages(pagetable_t pagetable, uint64 va, uint64 size, uint64 pa, int perm)
{
  uint64 a;        // walking va — current chunk's va in this iteration
  uint64 last;     // last va we need to map (= start + size - PGSIZE)
  pte_t *pte;

  a = va;                              // start at the first va in the region
  last = va + size - PGSIZE;           // last va = one chunk before va+size

  for (;;) {
    if ((pte = walk(pagetable, a, 1)) == 0)   // find/build path to bottom slot
      return -1;                              // walk failed (kalloc out of memory)
    if (*pte & PTE_V)
      panic("mappages: remap");               // slot already used = double-map bug
    *pte = PA2PTE(pa) | perm | PTE_V;          // write the final mapping
    if (a == last)
      break;                                  // done with last chunk
    a += PGSIZE;
    pa += PGSIZE;
  }
  return 0;
}
```

### Loop role per piece

1. `a = va`, `last = va + size - PGSIZE` — set up walking variables.
2. `for (;;)` — infinite loop, broken by `if (a == last) break`. Runs `size / PGSIZE` times.
3. `walk(pagetable, a, 1)` — find/build the path to the bottom slot for `a`. With alloc=1, walk creates missing chunks. Returns slot's place-name or 0.
4. `*pte & PTE_V` panic — bottom slot is already mapped = kernel bug (double-install). Panic.
5. `*pte = PA2PTE(pa) | perm | PTE_V` — write the final mapping. Pack pa into chunk-name field, OR in perm flags and V.
6. `a += PGSIZE`, `pa += PGSIZE` — advance both to next chunk.

### Walk's PTE_V check vs mappages's PTE_V check

| Where | Slot type | If V is set | Meaning |
|---|---|---|---|
| walk | top, middle | descend via PTE2PA | normal; intermediate branch exists |
| mappages | bottom (after walk) | panic | double-install bug; refuse to overwrite |

### Example: kvmmap call for KERNBASE..etext (size = 0x7000)

```
last = 0x80000000 + 0x7000 - 0x1000 = 0x80006000

Iteration 1:  a = 0x80000000, pa = 0x80000000  →  walk allocates M2 + B2, writes B2[0]
Iteration 2:  a = 0x80001000, pa = 0x80001000  →  walk descends, writes B2[1]
Iteration 3:  a = 0x80002000, pa = 0x80002000  →  walk descends, writes B2[2]
Iteration 4:  a = 0x80003000, pa = 0x80003000  →  walk descends, writes B2[3]
Iteration 5:  a = 0x80004000, pa = 0x80004000  →  walk descends, writes B2[4]
Iteration 6:  a = 0x80005000, pa = 0x80005000  →  walk descends, writes B2[5]
Iteration 7:  a = 0x80006000, pa = 0x80006000  →  walk descends, writes B2[6]
             a == last → break
```

Only first iteration pays alloc cost. Subsequent iterations reuse the same middle/bottom chunks.

## Why mappages's loop is cheap — the sharing trick

vas that share high indexing-position groups share walk's path through
the tree. PX decomposes va's 27 high positions into three 9-position groups:

- PX(0) — positions 12..20 — picks 1 of 512 slots in the depth-0 chunk.
- PX(1) — positions 21..29 — picks 1 of 512 slots in the depth-1 chunk.
- PX(2) — positions 30..38 — picks 1 of 512 slots in the depth-2 chunk.

The low 12 positions of va = within-chunk-byte index for the leaf-pointed chunk.

### Sharing

| Two vas share | Consequence in walk |
|---|---|
| same PX(2)                       | same depth-2 slot → same depth-1 chunk |
| same PX(2) and PX(1)             | same depth-2 + depth-1 slots → same depth-0 chunk |
| same PX(2), PX(1), PX(0)         | same leaf slot — they map the SAME 4096 storage units |

### Mappages loop behavior

`a` advances by 4096 each iteration. PX(0) increments by 1 each step.
PX(1) increments by 1 only when PX(0) wraps from 511 → 0 (every 512 iterations).
PX(2) increments only when PX(1) wraps (every 512×512 iterations).

So 512 consecutive iterations share the same depth-2 path and the same depth-1
chunk. Walk builds those once; reuses for the next 511 calls. Only at every
512th iteration does walk allocate a NEW depth-0 chunk; only at every
512×512 iteration does walk allocate a new depth-1 chunk.

### For the kernel data call (128 MB)

- 32,761 iterations.
- 64 new depth-0 chunks (one per 512 iterations).
- 0 new depth-1 chunks (first one already existed from KERNBASE call).
- 0 new depth-2 chunks (root already existed).

Total new tree allocation: 64 chunks × 4096 = 256 KB for 128 MB of mappings.

## Concrete numbers — vas sharing PX(2)

PX(2, va) extracts only 9 of va's 64 positions (positions 30..38).
Two different vas have the same PX(2) whenever those 9 positions agree,
regardless of what the OTHER 55 positions look like.

Three different vas, same PX(2):

```
va = 0x80000000:
  positions 30..38: 0 0 0 0 0 0 0 1 0   →  PX(2) = 2
  (only position 31 is set across all 64)

va = 0x80007000:
  positions 30..38: 0 0 0 0 0 0 0 1 0   →  PX(2) = 2
  (positions 12, 13, 14, 31 are set; positions 30..38 only have 31)

va = 0x81000000:
  positions 30..38: 0 0 0 0 0 0 0 1 0   →  PX(2) = 2
  (positions 24, 31 are set; positions 30..38 only have 31)

ALL THREE have PX(2) = 2.
```

All three lookups land at the SAME depth-2 slot (slot 2), which points to
the SAME depth-1 chunk. Walk allocates the depth-1 chunk only once; all
three vas reuse it.

Consequence: in mappages's for-loop, consecutive `a` values (each one chunk
apart) share PX(2) for very long stretches. Walk reuses the depth-2 path
and depth-1 chunk; only allocates a new depth-0 chunk when PX(1) changes
(every 512 iterations).

## Trampoline — Professional Explanation

### What it is

A small assembly stub (`trampoline.S`) containing `uservec` (trap entry) and
`userret` (trap exit). Mapped at virtual address `TRAMPOLINE = MAXVA - PGSIZE`
in EVERY page table (user pagetables, kernel pagetable, and post-Lab 3
per-process kernel pagetables).

### The problem it solves

When user runs `ecall`, RISC-V hardware:
1. Switches U-mode → S-mode.
2. Saves PC in sepc, sets PC ← stvec.
3. DOES NOT change satp — user pagetable still active.

The kernel needs to swap satp to its own pagetable so it can reach kernel
.text (where `usertrap()` lives). But: the instruction that writes satp
must itself be reachable both BEFORE and AFTER the swap. If it's only in
the user pagetable, post-swap fetch faults. If only in kernel pagetable,
pre-swap can't reach it.

Solution: place the satp-write instruction in a page mapped at the SAME va
in BOTH pagetables. That page is the trampoline.

### Trap entry sequence (timing)

```
t0  active=user    PC=user_code           user runs `ecall`
t1  active=user    PC=TRAMPOLINE          HW set PC ← stvec; mode → S.
                                            user PT maps TRAMPOLINE → fetch OK.
t2  active=user    PC=TRAMPOLINE+N        uservec saves 31 user regs into trapframe
t3  active=user    PC=TRAMPOLINE+M        uservec: csrw satp, kernel_pt
                                            ATP CHANGES NOW.
t4  active=KERNEL  PC=TRAMPOLINE+M+4      kernel PT also maps TRAMPOLINE → fetch OK
                                            (next trampoline instruction).
t5  active=kernel  PC=TRAMPOLINE+M+8      sfence.vma flushes TLB.
t6  active=kernel  PC=0x80003124          uservec jumps to usertrap() in C.
                                            kernel PT maps it → fetch OK.
```

### Why user can't execute the trampoline themselves

Three layers of defense:

1. **PTE_U cleared on the trampoline's user-pagetable mapping.** User mode
   trying to fetch from TRAMPOLINE faults (MMU checks PTE_U on every access
   in U-mode).
2. **`csrw satp` is a privileged instruction.** Even if user reached it,
   executing it from U-mode raises illegal-instruction exception.
3. **`usertrap()`'s VA isn't in the user pagetable.** Even if satp swap
   succeeded somehow, the jump to usertrap() would fault.

Only `ecall` (which HW-elevates to S-mode before jumping to stvec) bypasses
these layers — that's the only legitimate U → S transition.

### Why TRAMPOLINE = MAXVA - PGSIZE

Highest possible VA minus one page. Far from user space (low VAs) and
kernel space (KERNBASE = 0x80000000). No conflict with anything.

### Linux equivalent

KPTI's entry trampoline (kernel 4.15, Jan 2018). Same shape: a tiny page
mapped at the same VA in both user and kernel pagetables, used as the
safe location for CR3 swap on syscall entry.

## Task 3 — Mirror user arrows into per-task kpagetable

### Why

After Task 2, the per-task kpagetable has all kernel arrows but ZERO user
arrows. When privileged code dereferences a user va, the active tree
(kpagetable) doesn't know it → fault. To make `copyin` collapse to
`memmove`, the active tree must ALSO have the user arrows.

### The helper

```c
int
kvmcopymappings(pagetable_t src, pagetable_t dst, uint64 oldsz, uint64 newsz)
{
  for (uint64 va = PGROUNDUP(oldsz); va < newsz; va += PGSIZE) {
    pte_t *pte    = walk(src, va, 0);
    uint64 pa     = PTE2PA(*pte);
    uint64 flags  = PTE_FLAGS(*pte);
    if (mappages(dst, va, PGSIZE, pa, flags & ~PTE_U) != 0) {
      uvmunmap(dst, PGROUNDUP(oldsz), (va - PGROUNDUP(oldsz)) / PGSIZE, 0);
      return -1;
    }
  }
  return 0;
}
```

Walks src for each va in [oldsz, newsz) by PGSIZE steps. Reads the
existing arrow's (pa, flags), installs the same arrow in dst with
PTE_U cleared.

PTE_U is cleared so S-mode can dereference these arrows (RISC-V default:
S-mode can't touch PTE_U=1 pages without setting SUM in sstatus).

### Hook sites

Four places where user space changes:

1. **userinit** (after `uvminit + p->sz = PGSIZE`):
   ```c
   kvmcopymappings(p->pagetable, p->kpagetable, 0, p->sz);
   ```

2. **kfork** (after `uvmcopy(p->pagetable, np->pagetable, p->sz)`):
   ```c
   kvmcopymappings(np->pagetable, np->kpagetable, 0, np->sz);
   ```

3. **exec** (after the commit `p->pagetable = pagetable; p->sz = sz`):
   ```c
   uvmunmap(p->kpagetable, 0, PGROUNDUP(oldsz)/PGSIZE, 0);
   kvmcopymappings(p->pagetable, p->kpagetable, 0, sz);
   ```

4. **growproc** (both branches):
   ```c
   // grow (after uvmalloc):
   kvmcopymappings(p->pagetable, p->kpagetable, oldsz, sz);

   // shrink (after uvmdealloc):
   uvmunmap(p->kpagetable, PGROUNDUP(newsz),
            (PGROUNDUP(oldsz) - PGROUNDUP(newsz)) / PGSIZE, 0);
   ```

### Invariant

At any moment the task could trap to S-mode, kpagetable's user arrows
must match p->pagetable's user arrows for [0, p->sz). Miss a hook →
copyin faults or returns garbage.

### Upper limit on user size

User arrows live at low vas (growing up from 0). Kernel arrows in the
kpagetable include PLIC at 0x0c000000 (lowest kernel arrow). If user
grew past PLIC, the mirror would collide with PLIC's arrows → mappages
panics ("remap"). So: **user sz must stay below PLIC = 0x0c000000** (~192 MB).

Linux avoids this by putting kernel arrows in the upper half of va
(above sign-extension boundary, on x86_64). xv6 doesn't use sign-extension.

Check in growproc and exec:
```c
if (sz + n >= PLIC || sz >= PLIC)
    return -1;
```

### PGROUNDUP in the shrink branch

Chunks are atomic — you can't half-unmap. So when shrinking from
sz=0x4000 to sz=0x2500, the chunk holding vas 0x2000..0x2FFF stays
mapped (it contains the new top sz). Only chunks ABOVE PGROUNDUP(newsz)
get removed.

```
Before sbrk(-0x1B00):                 After:
  va 0x0000..0x0fff → W (mapped)        va 0x0000..0x0fff → W (mapped)
  va 0x1000..0x1fff → X (mapped)        va 0x1000..0x1fff → X (mapped)
  va 0x2000..0x2fff → Y (mapped)        va 0x2000..0x2fff → Y (still mapped)
  va 0x3000..0x3fff → Z (mapped)        va 0x3000..0x3fff → UNMAPPED
                                         (Z freed)
  sz = 0x4000                           sz = 0x2500
```

uvmdealloc uses `PGROUNDUP(newsz) = 0x3000` as start, removes chunk Z
only. kpagetable mirror unmap must use the same boundary to stay in sync.

### Nested loops in kvmcopymappings

```
kvmcopymappings:
  loop: for each chunk in [oldsz, newsz):
    walk(src, va, 0)                       ← 2 descent passes inside walk
    mappages(dst, va, PGSIZE, ...):
      loop: for each chunk in PGSIZE (1):
        walk(dst, va, 1)                   ← 2 descent passes
        write the leaf slot

Total per kvmcopymappings call: N × (2 + 2 + 1) reads/writes
where N = (newsz - oldsz) / PGSIZE.
```

## Vmprint job at a glance

Given the top chunk's place-name, visit every used slot at every level and
print one line per visit. Each line is:
```
<indent> <slot index>: pte <slot's 8-byte value> pa <PTE2PA(slot)>\n
```
where `<indent>` is " .." repeated (depth + 1) times.

Call `vmprint(p->pagetable)` from `exec()` when this is the first task
(p->pid == 1).
