const modules = [
  {
    title: "Unix Surface",
    short: "argv, fd, pipe, fork, exec, wait.",
    trap: "argv[0] exists. argv[argc] is NULL. A pipe read waits forever if a writer still exists.",
    tags: ["argv", "fd", "pipe"]
  },
  {
    title: "Syscall Path",
    short: "User call, trap entry, dispatcher, return value.",
    trap: "The return value is written back after the handler returns. If you restore a0, return the restored a0.",
    tags: ["a7", "a0", "trace"]
  },
  {
    title: "Lookup Tree",
    short: "A 3-step table that turns a user number into a real chunk.",
    trap: "PTE2PA takes a slot value, not the table pointer. walk returns a slot address so the caller can write.",
    tags: ["satp", "PTE", "vmprint"]
  },
  {
    title: "Traps",
    short: "Frame walk, alarm, saved register state.",
    trap: "Save the trapframe before changing epc. A second alarm while the handler runs destroys the saved state.",
    tags: ["s0", "epc", "a0"]
  },
  {
    title: "COW Fork",
    short: "Share first. Copy only on write.",
    trap: "Kernel writes through copyout do not fault, so copyout must resolve COW itself.",
    tags: ["fork", "fault", "refcount"]
  },
  {
    title: "User Threads",
    short: "Save 14 cells, load 14 cells, ret into another flow.",
    trap: "current_thread must change before switch. The line after switch may not run for this flow now.",
    tags: ["ra", "sp", "s0"]
  },
  {
    title: "Network Card",
    short: "Four tables, two card registers, boxes, doorbells.",
    trap: "The row stores data start. The side slot stores box start. They are not the same number.",
    tags: ["E1000", "DD", "DMA"]
  },
  {
    title: "Lock Lab",
    short: "Split one hot gate into many local gates.",
    trap: "cpuid is only safe while interrupts are off. Stealing without a fixed order creates a two-core wait loop.",
    tags: ["kalloc", "bcache", "contention"]
  },
  {
    title: "File System",
    short: "Bigger files, symbolic paths, block indexes.",
    trap: "The second indirect layer changes both allocation and freeing. Forget freeing one layer and the disk leaks.",
    tags: ["inode", "blocks", "symlink"]
  },
  {
    title: "mmap",
    short: "Map file bytes into a process and write them back when required.",
    trap: "munmap can split a range. Dirty pages and file offsets decide what gets written.",
    tags: ["VMA", "fault", "file"]
  },
  {
    title: "Memory Order",
    short: "Barriers, cache lines, store buffers, TSO.",
    trap: "Loads can pass earlier loads, stores can pass earlier stores, but stores cannot pass earlier loads.",
    tags: ["fence", "acquire", "release"]
  }
];

const lessons = [
  {
    id: "net",
    title: "Network Card Driver",
    subtitle: "E1000 from rows and boxes",
    level: "advanced",
    summary:
      "The send and receive paths are one idea twice: the card reads or writes fixed rows in DRAM, while the driver keeps box pointers the card never sees.",
    diagram: `
slot | JOB row: card-facing              | BACK slot: driver-only
-----+-----------------------------------+-------------------------
  3  | ptr=0x8002_0040 len=74 cmd=0x09   | 0x8002_0000

0x8002_0000: [box description]
0x8002_0040: [data bytes the card reads]
`,
    beats: [
      "Keep two channels separate: descriptor rows in DRAM, card registers over the bus.",
      "Test one flag with AND. Never compare the whole status byte to 1.",
      "Transmit stores m->head in tx_ring[i].addr and m in tx_mbufs[i].",
      "Receive hands rx_mbufs[i] upward, then immediately replaces it with a fresh empty box.",
      "Fence before the doorbell if you want real-device correctness: fill row first, ring later."
    ],
    blanks: [
      {
        prompt: "TX full check: if ((tx_ring[i].status & ________) == 0) return -1;",
        answer: "E1000_TXD_STAT_DD"
      },
      {
        prompt: "TX row pointer: tx_ring[i].addr = (uint64) ________;",
        answer: "m->head"
      },
      {
        prompt: "RX next slot: uint32 i = (regs[E1000_RDT] + 1) % ________;",
        answer: "RX_RING_SIZE"
      }
    ],
    code: `int
e1000_transmit(struct mbuf *m)
{
  acquire(&e1000_lock);

  uint32 i = regs[E1000_TDT];
  if ((tx_ring[i].status & E1000_TXD_STAT_DD) == 0) {
    release(&e1000_lock);
    return -1;
  }
  if (tx_mbufs[i])
    mbuffree(tx_mbufs[i]);

  tx_ring[i].addr = (uint64)m->head;
  tx_ring[i].length = m->len;
  tx_ring[i].cmd = E1000_TXD_CMD_EOP | E1000_TXD_CMD_RS;
  tx_mbufs[i] = m;
  __sync_synchronize();
  regs[E1000_TDT] = (i + 1) % TX_RING_SIZE;

  release(&e1000_lock);
  return 0;
}`
  },
  {
    id: "uthread",
    title: "User Threads",
    subtitle: "A ret that wakes another flow",
    level: "intermediate",
    summary:
      "A voluntary switch only needs the cells the calling convention promises to preserve: ra, sp, and s0 through s11.",
    diagram: `
old ctx                         new ctx
-------                         -------
ra <- saved return point        ra -> where new flow resumes
sp <- old stack top             sp -> new stack top
s0..s11                         s0..s11

switch saves old, loads new, ret reads the new ra.
`,
    beats: [
      "A fresh flow has never run, so its saved ra is the function pointer.",
      "A saved flow has run, so its saved ra is an address inside its caller.",
      "Slot 0 belongs to the scheduler. New worker flows start at slot 1.",
      "Update current_thread before switching; the line after switch is not a safe place for that update.",
      "No RUNNING state is needed in this cooperative version."
    ],
    blanks: [
      {
        prompt: "thread_create must set t->ctx.ra = (uint64) ________;",
        answer: "func"
      },
      {
        prompt: "The first usable worker slot is i = ________, not 0.",
        answer: "1"
      },
      {
        prompt: "Before switch: struct thread *old = current_thread; current_thread = ________;",
        answer: "next"
      }
    ],
    code: `struct thread *old = current_thread;
current_thread = next;
uthread_switch(&old->ctx, &next->ctx);`
  },
  {
    id: "cow",
    title: "Copy-on-Write Fork",
    subtitle: "Copy after proof, not before",
    level: "advanced",
    summary:
      "Fork should not copy every page before knowing whether either side will write. Share, mark read-only, and copy only on a write fault.",
    diagram: `
before write:
  parent va 0x4000 -> P4  read-only, COW
  child  va 0x4000 -> P4  read-only, COW
  refcount[P4] = 2

parent writes:
  fault -> allocate N4 -> copy P4 to N4
  parent va 0x4000 -> N4 writable
  child  va 0x4000 -> P4 read-only
`,
    beats: [
      "Clearing PTE_W is what forces the write fault.",
      "The COW flag distinguishes expected COW faults from illegal writes.",
      "refcount decides whether to copy or just flip W back on.",
      "copyout is special because kernel writes do not trigger the user write fault.",
      "A stale TLB entry can make a fixed PTE look unfixed. Fence after changing it."
    ],
    blanks: [
      {
        prompt: "On fork, parent and child both map the same pa with PTE_W ________.",
        answer: "cleared"
      },
      {
        prompt: "On COW fault with refcount > 1, allocate, copy, install new pa, then refcount old pa ________.",
        answer: "decrements"
      },
      {
        prompt: "Kernel-side writes into user memory must resolve COW in ________.",
        answer: "copyout"
      }
    ],
    code: `if (ref_get(pa) > 1) {
  char *mem = kalloc();
  memmove(mem, (char*)pa, PGSIZE);
  *pte = PA2PTE(mem) | flags | PTE_W;
  *pte &= ~PTE_COW;
  ref_dec(pa);
} else {
  *pte |= PTE_W;
  *pte &= ~PTE_COW;
}`
  },
  {
    id: "lookup-tree",
    title: "Lookup Tree",
    subtitle: "Three chunks, one final slot",
    level: "core",
    summary:
      "The CPU starts with satp, picks one slot per level, strips flags from each slot, and lands on the final physical chunk.",
    diagram: `
user number N:
  [ top index ][ middle index ][ bottom index ][ within-chunk position ]
       9              9              9                  12

satp -> top chunk -> middle chunk -> bottom chunk -> final data chunk
`,
    beats: [
      "satp names the top chunk; slot values are packed.",
      "PX(level, va) picks which slot to inspect.",
      "PTE2PA(slot) strips flags and restores the zero low positions.",
      "walk returns a pointer to the bottom slot so mappages can write through it.",
      "vmprint loops over every valid slot; lookup follows only one path."
    ],
    blanks: [
      {
        prompt: "PTE2PA takes a ________ value, not the table pointer.",
        answer: "pte / slot"
      },
      {
        prompt: "mappages panics if *pte & ________ is already set.",
        answer: "PTE_V"
      },
      {
        prompt: "walk returns &pagetable[PX(0, va)] so the caller can ________ the slot.",
        answer: "write"
      }
    ],
    code: `pte_t *slot = walk(pagetable, va, 1);
if (*slot & PTE_V)
  panic("mappages: remap");
*slot = PA2PTE(pa) | perm | PTE_V;`
  },
  {
    id: "lock-lab",
    title: "Lock Lab",
    subtitle: "One hot gate becomes many local gates",
    level: "current",
    summary:
      "The stock allocator has one global free chain. The lab asks you to split the gate so independent cores stop fighting on one word.",
    diagram: `
before:
  kmem.lock -> freelist -> slab -> slab -> slab -> 0

after:
  kmem[0].lock -> chain0
  kmem[1].lock -> chain1
  ...
  kmem[7].lock -> chain7
`,
    beats: [
      "Split kmem, not the COW refcount gate.",
      "cpuid must be read while interrupts are off.",
      "kfree returns a slab to the current core's chain.",
      "kalloc first tries the current chain, then steals from another chain if empty.",
      "The bcache half repeats the idea with hash buckets and fixed lock ordering."
    ],
    blanks: [
      {
        prompt: "The allocator state becomes kmem[________].",
        answer: "NCPU"
      },
      {
        prompt: "Before cpuid(), call ________ so the core id cannot change under you.",
        answer: "push_off()"
      },
      {
        prompt: "Do not split kref_lock because it guards ________, not the free chains.",
        answer: "reference counts"
      }
    ],
    code: `struct {
  struct spinlock lock;
  struct run *freelist;
} kmem[NCPU];`
  },
  {
    id: "unix-surface",
    title: "Unix Surface",
    subtitle: "argv, fd, pipe, fork, exec, wait",
    level: "core",
    summary:
      "A process starts with argc >= 1, argv[0] = program name, argv[argc] = NULL, three open file descriptors (0, 1, 2), and a 64-slot process table shared across the whole system.",
    diagram: `
fork() copies fd table (NOFILE=16 slots):
  +----+-----------+          +----+-----------+
  | fd | file*     | PARENT   | fd | file*     | CHILD
  +----+-----------+          +----+-----------+
  |  0 | console R |          |  0 | console R |
  |  1 | console W |          |  1 | console W |
  |  2 | console W |          |  2 | console W |
  |  3 | pipe read |          |  3 | pipe read |
  |  4 | pipe write|          |  4 | pipe write|
  +----+-----------+          +----+-----------+
  SAME fd numbers, SAME struct file* pointers
  but SEPARATE address spaces: int x in parent != int x in child

pipe internals (kernel/pipe.c):
  +------------------+
  | char data[512]   |  ring, PIPESIZE=512
  | uint nread = 0   |
  | uint nwrite = 0  |
  | int readopen = 1 |
  | int writeopen= 1 |
  +------------------+
  read blocks when nread == nwrite AND writeopen == 1
  read returns 0 when nread == nwrite AND writeopen == 0
`,
    beats: [
      "atoi(\"hello\") returns 0 silently. The while loop ('0' <= *s && *s <= '9') never runs. You must validate digits yourself before calling atoi.",
      "After fork, parent and child share the SAME struct file (pipe refcount = 2). If child forgets close(p2c[1]), writeopen stays 1, and read(p2c[0]) blocks forever instead of returning 0.",
      "exec replaces text/data/stack but keeps the fd table. If exec returns, it FAILED — child must exit(1) or it falls through executing parent code with child pid.",
      "wait(0) reaps one ZOMBIE child and frees its proc[N] slot. Without wait, 64 forks exhaust NPROC and fork returns -1.",
      "strcmp(s, t) compares bytes. s == t compares pointers (addresses), which are never equal for separate strings even with identical content."
    ],
    blanks: [
      { prompt: "if (fork() == 0) { exec(\"/bin/ls\", args); ________; }", answer: "exit(1)" },
      { prompt: "pipe(p); fork(); /* in parent: */ close(p[________]); read(p[________], buf, 1);", answer: "1 (close write-end), 0 (read from read-end)" },
      { prompt: "int pid = fork(); /* child sets x=42 */ — parent reads x, gets ________", answer: "the original value (not 42) — separate address spaces" }
    ],
    code: `// pingpong.c — fork, pipe, close unused ends, wait
int main(void) {
  int p2c[2], c2p[2];
  char byte = 'x';
  pipe(p2c);
  pipe(c2p);
  int pid = fork();
  if (pid == 0) {
    close(p2c[1]); close(c2p[0]);
    read(p2c[0], &byte, 1);
    close(p2c[0]);
    fprintf(1, "%d: received ping\\n", getpid());
    write(c2p[1], &byte, 1);
    close(c2p[1]);
    exit(0);
  }
  close(p2c[0]); close(c2p[1]);
  write(p2c[1], &byte, 1);
  close(p2c[1]);
  read(c2p[0], &byte, 1);
  close(c2p[0]);
  fprintf(1, "%d: received pong\\n", getpid());
  wait(0);
  exit(0);
}`
  },
  {
    id: "syscall-path",
    title: "Syscall Path",
    subtitle: "ecall, trapframe, dispatch, a0 back",
    level: "core",
    summary:
      "User code loads the syscall number into a7 and runs ecall. The trampoline saves all 31 registers to the trapframe. The dispatcher indexes a function table by a7, calls the handler, and writes the return value into trapframe->a0.",
    diagram: `
user calls read(3, 0x1000, 512):
  a0=3 (fd)  a1=0x1000 (buf)  a2=512 (n)  a7=5 (SYS_read)

ecall ──► trampoline (uservec):
  save all 31 regs to trapframe at TRAPFRAME = MAXVA - 2*PGSIZE
  trapframe->a0 = 3   a1 = 0x1000   a2 = 512   a7 = 5
  load kernel sp, jump to usertrap()

usertrap() ──► syscall():
  num = p->trapframe->a7             // 5
  p->trapframe->a0 = syscalls[5]()   // sys_read() returns 512
  // a0 was 3 (fd), now OVERWRITTEN with 512 (return value)

trap-return (userret):
  restore all regs from trapframe
  user a0 = 512
  sret ──► user resumes
`,
    beats: [
      "a0 is double-duty: argument 0 going IN (fd=3), return value coming OUT (512). The dispatcher overwrites it after the handler returns.",
      "ecall saves NOTHING to memory. It sets scause=8, copies pc to sepc, and flips to S-mode. uservec must sacrifice one register to get the TRAPFRAME base.",
      "argint(0, &fd) reads p->trapframe->a0 — the SAVED register, not the live one. The kernel runs on a different stack with different registers.",
      "The dispatcher line runs AFTER your handler returns. If sigreturn restores a0 and then returns 0, the dispatcher overwrites the restored value with 0.",
      "<< binds tighter than & in C, so mask & 1 << num already parses as mask & (1 << num). The real precedence trap is ==, which binds tighter than &: mask & 1 == 0 parses as mask & (1 == 0), almost never what you meant."
    ],
    blanks: [
      { prompt: "syscall dispatch: num = p->trapframe->________;", answer: "a7" },
      { prompt: "trace check: if (p->tracemask & (1 << ________))", answer: "num" },
      { prompt: "argint(0, &fd) reads p->trapframe->________, not a live register.", answer: "a0" }
    ],
    code: `void syscall(void) {
  int num;
  struct proc *p = myproc();
  num = p->trapframe->a7;
  if (num > 0 && num < NELEM(syscalls) && syscalls[num]) {
    p->trapframe->a0 = syscalls[num]();
    if (p->tracemask & (1 << num))
      printf("%d: syscall %s -> %d\\n",
             p->pid, syscall_names[num], p->trapframe->a0);
  } else {
    printf("%d %s: unknown sys call %d\\n",
           p->pid, p->name, num);
    p->trapframe->a0 = -1;
  }
}`
  },
  {
    id: "traps",
    title: "Traps",
    subtitle: "Walk the stack, hijack the return",
    level: "core",
    summary:
      "Backtrace reads fp-8 for the return address and fp-16 for the previous frame, walking up until the frame leaves the kernel stack chunk. Alarm saves the full trapframe before rewriting epc, then sigreturn restores it.",
    diagram: `
KERNEL STACK (4096 units, one per task):

  PGROUNDUP(fp) ──────────────────────────────────
                 ┌────────────────────────────────┐
                 │ usertrap's saved ra             │ fp_ut - 8
                 │ usertrap's saved prev-fp        │ fp_ut - 16
                 │ usertrap's locals               │
                 ├────────────────────────────────┤ ← fp_sc
                 │ syscall's saved ra              │ fp_sc - 8
                 │  (= addr inside usertrap)       │
                 │ syscall's saved prev-fp         │ fp_sc - 16
                 ├────────────────────────────────┤ ← fp (s0)
                 │ backtrace's saved ra            │ fp - 8
                 │ backtrace's saved prev-fp       │ fp - 16
                 └────────────────────────────────┘ ← sp

Walk: print *(fp-8). fp = *(fp-16). Stop when fp >= PGROUNDUP.
`,
    beats: [
      "ra at fp-8, previous fp at fp-16. Stack grows DOWN so older frames are at higher addresses.",
      "Bound the walk with PGROUNDUP(fp): kernel stack is one 4096-unit chunk. Past the top is garbage.",
      "Read s0 (= fp) via inline asm: asm volatile(\"mv %0, s0\" : \"=r\"(x)). C cannot name hardware registers.",
      "Save the ENTIRE trapframe BEFORE changing epc. Save after = epc already points at handler = sigreturn loops.",
      "sys_sigreturn returns p->trapframe->a0, not 0. The dispatcher writes the return value into a0 AFTER the handler returns — returning the restored a0 makes that write a no-op."
    ],
    blanks: [
      { prompt: "backtrace walk bound: while (fp < ________)", answer: "PGROUNDUP(fp)" },
      { prompt: "alarm save: p->tf_backup = *(p->trapframe); THEN p->trapframe->epc = ________;", answer: "(uint64)p->handler" },
      { prompt: "sys_sigreturn returns p->trapframe->________ so the a0 overwrite is a no-op.", answer: "a0" }
    ],
    code: `// backtrace
void backtrace(void) {
  uint64 fp = r_fp();
  uint64 top = PGROUNDUP(fp);
  while (fp < top) {
    printf("%p\\n", *(uint64*)(fp - 8));
    fp = *(uint64*)(fp - 16);
  }
}

// alarm (usertrap timer branch)
if (which_dev == 2 && p->interval > 0 && !p->alarm_on) {
  p->ticks++;
  if (p->ticks >= p->interval) {
    p->ticks = 0;
    p->alarm_on = 1;
    p->tf_backup = *(p->trapframe);
    p->trapframe->epc = (uint64)p->handler;
  }
}

// sigreturn
uint64 sys_sigreturn(void) {
  struct proc *p = myproc();
  *(p->trapframe) = p->tf_backup;
  p->alarm_on = 0;
  return p->trapframe->a0;
}`
  },
  {
    id: "filesystem",
    title: "File System",
    subtitle: "Two layers of indirection, one symlink guard",
    level: "advanced",
    summary:
      "Stock xv6 supports 268 blocks per file (12 direct + 256 indirect). Adding a doubly-indirect entry gives 65803 blocks. Symbolic links store a path in a data block; open() follows with a depth counter.",
    diagram: `
inode addrs[13]:
  addrs[0..10]  ── 11 direct ──► data blocks
  addrs[11]     ── 1 indirect ──► [256 block#] ──► 256 data blocks
  addrs[12]     ── 1 dbl-indirect ──► [256 ptrs] ──► each ──► [256 block#] ──► data

  total: 11 + 256 + 256*256 = 65803 blocks

bmap(ip, bn):
  bn < 11                     → addrs[bn]        (direct)
  bn < 11 + 256               → walk 1 level     (indirect)
  bn < 11 + 256 + 65536       → walk 2 levels    (doubly-indirect)

itrunc frees:
  1. direct blocks         addrs[0..10]
  2. indirect data + the pointer block itself
  3. dbl-indirect data + each L2 pointer block + the root block
  MISSING the L2 pointer blocks = silent disk leak
`,
    beats: [
      "addrs[12] points to a block of 256 pointers. Each points to a block of 256 data block numbers. Two levels = 256*256 = 65536 blocks.",
      "bmap must allocate missing pointer blocks on the fly. If addrs[12] is 0, balloc a root block. If a 2nd-level slot is 0, balloc a 2nd-level block.",
      "itrunc must free the L2 pointer blocks themselves, not just the data blocks they reference. Missing this leaks one block per 256 data blocks.",
      "Symlink depth limit: open() counts follows of T_SYMLINK. At depth 10, return -1. Without this, A->B->A loops forever inside the kernel.",
      "O_NOFOLLOW: if the final component is a symlink and O_NOFOLLOW is set, return the symlink inode itself."
    ],
    blanks: [
      { prompt: "Doubly-indirect total: 256 * ________ = 65536 blocks.", answer: "256" },
      { prompt: "itrunc must free L2 pointer blocks or the disk ________.", answer: "leaks" },
      { prompt: "open() follows symlinks up to depth ________ before error.", answer: "10" }
    ],
    code: `// bmap doubly-indirect (kernel/fs.c)
bn -= NINDIRECT;
if (bn < NDBLINDIRECT) {
  if ((addr = ip->addrs[NDIRECT + 1]) == 0)
    ip->addrs[NDIRECT + 1] = addr = balloc(ip->dev);
  bp = bread(ip->dev, addr);
  a = (uint*)bp->data;
  int idx1 = bn / NINDIRECT;
  if ((addr = a[idx1]) == 0) {
    a[idx1] = addr = balloc(ip->dev);
    log_write(bp);
  }
  brelse(bp);
  bp = bread(ip->dev, addr);
  a = (uint*)bp->data;
  int idx2 = bn % NINDIRECT;
  if ((addr = a[idx2]) == 0) {
    a[idx2] = addr = balloc(ip->dev);
    log_write(bp);
  }
  brelse(bp);
  return addr;
}`
  },
  {
    id: "mmap",
    title: "mmap",
    subtitle: "Map a file, fault it in, write it back",
    level: "advanced",
    summary:
      "mmap records a VMA but allocates no pages. The first access faults, the handler reads the file into a fresh page and maps it. munmap writes dirty shared pages back before freeing.",
    diagram: `
mmap(0, 4096, PROT_READ|PROT_WRITE, MAP_SHARED, fd=3, offset=0):

  page table (before fault):
    va 0x0000 ── code   ── mapped
    va 0x3000 ── stack  ── mapped
    va 0x6000 ── VMA    ── NOT mapped (no PTE, lazy)

  VMA slot:
    addr=0x6000  len=4096  prot=RW  flags=SHARED
    file=struct file*  offset=0

  after fault at va 0x6000:
    kalloc() -> pa 0x87f5a000
    readi(file, pa, offset=0, 4096)
    mappages(pagetable, 0x6000, 4096, 0x87f5a000, PTE_R|PTE_W|PTE_U)
`,
    beats: [
      "mmap does zero page allocation. It fills a VMA slot: addr, length, prot, flags, file pointer, offset.",
      "filedup() the file in mmap. The user can close(fd) after mmap — the VMA holds its own reference.",
      "Fault handler: scause 13 (load) or 15 (store), find matching VMA, read from file at (va - vma->addr + vma->offset), map the page.",
      "munmap writes dirty pages back ONLY if MAP_SHARED. MAP_PRIVATE changes are discarded on unmap.",
      "Partial unmap: munmap can shrink a VMA from either end but cannot punch a hole in the middle."
    ],
    blanks: [
      { prompt: "In mmap, call ________(f) so the file survives close(fd).", answer: "filedup" },
      { prompt: "Fault match: va >= vma->addr && va < vma->addr + ________", answer: "vma->length" },
      { prompt: "munmap writeback: only if vma->flags & ________", answer: "MAP_SHARED" }
    ],
    code: `// usertrap mmap fault handler
if (r_scause() == 13 || r_scause() == 15) {
  uint64 va = PGROUNDDOWN(r_stval());
  struct vma *v = 0;
  for (int i = 0; i < NVMA; i++) {
    if (p->vmas[i].mapped && va >= p->vmas[i].addr
        && va < p->vmas[i].addr + p->vmas[i].length) {
      v = &p->vmas[i];
      break;
    }
  }
  if (v == 0) { p->killed = 1; }
  char *mem = kalloc();
  memset(mem, 0, PGSIZE);
  ilock(v->file->ip);
  readi(v->file->ip, 0, (uint64)mem,
        v->offset + (va - v->addr), PGSIZE);
  iunlock(v->file->ip);
  int perm = PTE_U;
  if (v->prot & PROT_READ)  perm |= PTE_R;
  if (v->prot & PROT_WRITE) perm |= PTE_W;
  mappages(p->pagetable, va, PGSIZE, (uint64)mem, perm);
}`
  },
  {
    id: "memory-barrier",
    title: "Memory Barriers",
    subtitle: "Store buffers, cache lines, TSO",
    level: "advanced",
    summary:
      "Processors reorder loads and stores. Barriers enforce ordering: acquire before load, release after store, fence both ways.",
    diagram: `
Thread 0          Thread 1
-------          -------
x = 1;           while (y == 0);
__sync_synchronize();
y = 1;           print x;

Without fence: Thread 1 may print 0 (x not visible).
With fence: Thread 1 prints 1 (x visible before y).
`,
    beats: [
      "Loads can pass earlier loads, stores can pass earlier stores.",
      "Stores cannot pass earlier loads (TSO).",
      "acquire barrier: no later loads/stores can pass before this load.",
      "release barrier: no earlier loads/stores can pass after this store.",
      "full fence (__sync_synchronize): no reordering across it."
    ],
    blanks: [
      {
        prompt: "In xv6, e1000_transmit uses ________ before writing E1000_TDT.",
        answer: "__sync_synchronize()"
      },
      {
        prompt: "acquire(&lk) includes a ________ barrier after reading lk->locked.",
        answer: "acquire"
      },
      {
        prompt: "release(&lk) includes a ________ barrier before writing lk->locked = 0.",
        answer: "release"
      }
    ],
    code: `// acquire: load-acquire
__sync_synchronize();
while(__sync_lock_test_and_set(&lk->locked, 1) != 0)
  ;
__sync_synchronize();

// release: store-release  
__sync_synchronize();
lk->locked = 0;
__sync_synchronize();`
  }
];

const assignments = [
  {
    title: "A1 - Pipe and Process Cells",
    output: "Implement sleep, pingpong, primes, find, xargs.",
    proof: "Run each user program in xv6 and write a mistake log.",
    traps: ["argv[1] can be NULL", "read waits if writer fd is open", "strcmp, not pointer compare"]
  },
  {
    title: "A2 - Syscall Instrumentation",
    output: "Add trace(mask) and sysinfo(dst).",
    proof: "trace 32 grep hello README prints only read calls.",
    traps: ["== binds before &", "return value lives in a0", "copyout must use the user's pointer"]
  },
  {
    title: "A3 - Lookup Tree Print",
    output: "Implement vmprint and explain every printed row.",
    proof: "The pid 1 tree prints valid pte/pa pairs.",
    traps: ["PTE2PA takes slot value", "walk returns a slot pointer", "skip invalid slots"]
  },
  {
    title: "A4 - Trap Surgery",
    output: "Backtrace and alarm.",
    proof: "Alarm handler returns to the original user PC.",
    traps: ["save before epc change", "return restored a0", "block re-entry during handler"]
  },
  {
    title: "A5 - COW",
    output: "Make fork share pages and copy on write.",
    proof: "cowtest and usertests pass.",
    traps: ["copyout must handle COW", "refcount underflow", "stale TLB"]
  },
  {
    title: "A6 - User Threads",
    output: "Build uthread_switch and schedule flows.",
    proof: "Three flows run and exit with no runnable threads.",
    traps: ["slot 0 overwrite", "current_thread update location", "struct offset mismatch"]
  },
  {
    title: "A7 - Network Card",
    output: "Implement e1000_transmit and e1000_recv.",
    proof: "nettests passes; echo server sees 111 packets.",
    traps: ["DD bit mask", "box start vs data start", "doorbell before fill"]
  },
  {
    title: "A8 - Lock Lab",
    output: "Split kalloc and bcache contention points.",
    proof: "kalloctest and bcachetest show low spin counts.",
    traps: ["cpuid without push_off", "stealing deadlock", "wrong bucket during bpin"]
  },
  {
    title: "A9 - File System",
    output: "Add doubly-indirect file blocks and symbolic links.",
    proof: "bigfile, symlinktest, and grade-lab-fs pass.",
    traps: ["forgetting to free second-layer blocks", "following symlinks forever", "wrong open flag behavior"]
  },
  {
    title: "A10 - mmap",
    output: "Implement mmap and munmap with file-backed lazy faults.",
    proof: "mmaptest and grade-lab-mmap pass.",
    traps: ["partial unmap splits a range", "dirty page writeback rules", "file refcount lifetime"]
  },
  {
    title: "A11 - Memory Barriers",
    output: "Add acquire/release barriers to lock implementation.",
    proof: "Lock ordering test passes on 8 cores.",
    traps: ["acquire after load", "release before store", "fence both ways"]
  }
];

const localCode = [
  {
    assignment: "A1 util",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/util + labs/xv6-new user files",
    proof: "grade-lab-util exists in the 2021 checkout; xv6-new has the hand-written util programs."
  },
  {
    assignment: "A2 syscall",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/syscall + labs/xv6-new",
    proof: "trace.c, sysinfotest.c, and grade-lab-syscall exist in the 2021 checkout."
  },
  {
    assignment: "A3 pgtbl",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/pgtbl + notes/lab3_lookup_tree.md",
    proof: "grade-lab-pgtbl exists; local notes cover vmprint and per-process kernel page tables."
  },
  {
    assignment: "A4 traps",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/traps + labs/xv6-new",
    proof: "grade-lab-traps exists; xv6-new has alarm/backtrace wiring restored and buildable."
  },
  {
    assignment: "A5 COW",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/cow + notes/lab5_cow.md",
    proof: "cowtest.c and grade-lab-cow exist."
  },
  {
    assignment: "A6 thread",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/thread + labs/xv6-new/notxv6",
    proof: "uthread, ph.c, barrier.c, and grade-lab-thread exist."
  },
  {
    assignment: "A7 net",
    status: "supported and proven",
    path: "labs/xv6-labs-2021 origin/net + labs/xv6-new",
    proof: "nettests.c and grade-lab-net exist; xv6-new passed nettests with 111 echoed packets."
  },
  {
    assignment: "A8 lock",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/lock",
    proof: "kalloctest.c, bcachetest.c, stats.c, and grade-lab-lock exist."
  },
  {
    assignment: "A9 fs",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/fs",
    proof: "bigfile.c, symlinktest.c, and grade-lab-fs exist."
  },
  {
    assignment: "A10 mmap",
    status: "supported",
    path: "labs/xv6-labs-2021 origin/mmap",
    proof: "mmaptest.c and grade-lab-mmap exist."
  },
  {
    assignment: "A11 memory-barrier",
    status: "concept",
    path: "kernel/spinlock.c",
    proof: "Add acquire/release barriers to spinlock implementation."
  }
];

const drills = [
  {
    q: "tx_ring[4].status is 0x03 and E1000_TXD_STAT_DD is 0x01. Is slot 4 reusable?",
    a: "Yes. 0x03 & 0x01 = 0x01. The DD bit is set. Comparing status == 1 would be wrong because other status bits may also be set."
  },
  {
    q: "tx_mbufs[3] = 0x8002_0000 and tx_ring[3].addr = 0x8002_0040. Which number goes to mbuffree?",
    a: "0x8002_0000. That is the box start. tx_ring[3].addr points at data inside the box, not the whole box."
  },
  {
    q: "Two senders both read TDT = 4 without the gate. Sender A writes slot 4, then sender B writes slot 4. What vanished?",
    a: "A's packet vanished. Slot 4 ends with B's addr/len/cmd and tx_mbufs[4] ends with B's box. A returned success but its box is no longer tracked."
  },
  {
    q: "RX: RDT = 6. Which slot do you check, and what value do you write after processing it?",
    a: "Check (6 + 1) % RX_RING_SIZE = 7. After processing and refilling slot 7, write regs[E1000_RDT] = 7."
  },
  {
    q: "Why does sys_sigreturn return the restored a0 instead of 0?",
    a: "The syscall dispatcher writes the handler return value into trapframe->a0 after sys_sigreturn returns. Returning restored a0 makes that write preserve the original value."
  },
  {
    q: "A fresh user thread has never called switch before. What do you put in ctx.ra?",
    a: "The function pointer. The switch loads ra from ctx and ret jumps directly to the function."
  },
  {
    q: "kalloc is split into kmem[NCPU]. What must happen before calling cpuid?",
    a: "Interrupts must be disabled with push_off. Otherwise the code could move between cores after reading the id and touch the wrong chain."
  },
  {
    q: "PTE value is 0x21fda803. What does PTE2PA do conceptually?",
    a: "It removes the low flag positions, then restores the low zero positions required by chunk alignment, producing the clean physical chunk address."
  },
  {
    q: "pipe(p); fork(); child does close(p[0]) but forgets close(p[1]). Parent calls read(p[0], buf, 1). What happens?",
    a: "Parent blocks forever. p[1] write-end refcount is still > 0 (child kept it open), so read sees writeopen=1 and sleeps waiting for data that will never come."
  },
  {
    q: "fork() returns. Child calls exec(\"/bin/ls\", args). exec succeeds. What does the next line after exec in the child run?",
    a: "Nothing. exec replaces the entire address space on success and never returns. The old code is gone. If exec did return, it means it failed."
  },
  {
    q: "User calls read(3, 0x1000, 512). In the kernel, argint(0, &fd) returns 3. Where did it read 3 from?",
    a: "From p->trapframe->a0. The user's a0=3 (fd) was saved to the trapframe by uservec in trampoline.S. argint reads the saved value, not a live register."
  },
  {
    q: "COW fork: parent and child both map va 0x4000 to pa P4 read-only. Parent writes to 0x4000. refcount[P4] is 2. Walk through the fault.",
    a: "Write fault fires. Handler sees PTE has COW flag. refcount > 1, so: kalloc new page N4, memmove P4 to N4, remap parent 0x4000 to N4 with PTE_W, clear COW flag, decrement refcount[P4] to 1. Parent resumes writing to N4."
  },
  {
    q: "COW: kernel calls copyout(pagetable, useraddr, kernelbuf, n). The destination page is COW. Does a write fault fire?",
    a: "No. Kernel writes via copyout go through the page table software walk, not the MMU. copyout must check for COW itself and resolve it before copying."
  },
  {
    q: "File system: itrunc frees data blocks under the doubly-indirect entry but not the L2 pointer blocks. What symptom?",
    a: "Silent disk leak. Each L2 pointer block (256 entries) is one block. Over many create/delete cycles, free blocks decrease until the disk is full. No panic, no error — just gradually runs out."
  },
  {
    q: "mmap(0, 4096, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0). Then close(fd). Then access the mapped page. What happens?",
    a: "Works fine IF mmap called filedup(f) to increment the file refcount. close(fd) decrements it to 1 (VMA still holds a ref). The fault handler reads from the file normally. Without filedup, close drops the refcount to 0, file is freed, fault handler dereferences garbage."
  },
  {
    q: "Thread 0: x = 1; __sync_synchronize(); y = 1; Thread 1: while (y == 0); print x; Without fence, Thread 1 may print 0. Why?",
    a: "Store buffer reordering. Thread 0's store to x may stay in its store buffer while y = 1 reaches memory. Thread 1 sees y = 1 but x = 0. Fence flushes store buffer before y = 1."
  },
  {
    q: "acquire(&lk) includes __sync_synchronize() after reading lk->locked. Why after, not before?",
    a: "acquire barrier ensures no later loads/stores pass before this load. Must be after reading lk->locked to prevent reordering of critical section code before the lock is acquired."
  }
];

const styleRules = [
  {
    title: "Start With State",
    text: "Begin every lesson with a concrete state: register values, row contents, pointer values, or a drawn memory chunk."
  },
  {
    title: "One Trap Per Step",
    text: "Ask for one missing condition or assignment. Then explain exactly why the wrong version fails."
  },
  {
    title: "Name Late",
    text: "Use plain roles first: card row, box start, data start, gate cell. Give the standard term after the learner sees the mechanism."
  },
  {
    title: "No Motivational Fog",
    text: "Do not say the topic is important. Show the exact panic, leak, hang, or wrong byte."
  },
  {
    title: "Proof Required",
    text: "Every module ends with a local test, a transcript, or a numeric invariant the learner can check."
  },
  {
    title: "Reusable Output",
    text: "Each post should leave behind a small artifact: lesson, assignment, checklist, or interview drill."
  }
];

/* -- helpers ------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const labLinks = {
  "unix-surface": "mit_os_2025/labs/util.html",
  "syscall-path": "mit_os_2025/labs/syscall.html",
  "lookup-tree": "mit_os_2025/labs/pgtbl.html",
  traps: "mit_os_2025/labs/traps.html",
  cow: "mit_os_2025/labs/cow.html",
  uthread: "mit_os_2025/labs/thread.html",
  net: "mit_os_2025/labs/net.html",
  "lock-lab": "mit_os_2025/labs/lock.html",
  filesystem: "mit_os_2025/labs/fs.html",
  mmap: "mit_os_2025/labs/mmap.html"
};

const noteLinks = {
  "unix-surface": { file: "notes/ch01_foundation.md", label: "Ch 1: Unix Foundation" },
  "syscall-path": { file: "notes/ch02_syscall_path.md", label: "Ch 2: Syscall Path" },
  "lookup-tree": { file: "notes/ch03_address_translation.md", label: "Ch 3: Address Translation" },
  traps: { file: "notes/ch04_traps_backtrace_alarm.md", label: "Ch 4: Traps & Alarm" },
  cow: { file: "notes/ch05_cow_fork.md", label: "Ch 5: COW Fork" },
  uthread: { file: "notes/ch06_user_threads.md", label: "Ch 6: User Threads" },
  net: { file: "notes/ch07_net_driver.md", label: "Ch 7: Net Driver" },
  "lock-lab": { file: "notes/ch08_lock_lab.md", label: "Ch 8: Lock Lab" },
  filesystem: { file: "notes/ch09_filesystem.md", label: "Ch 9: Filesystem" },
  mmap: { file: "notes/ch10_mmap.md", label: "Ch 10: mmap" },
  "memory-barrier": { file: "notes/ch11_memory_order.md", label: "Ch 11: Memory Order" }
};

const allNotes = [
  { file: "notes/ch01_foundation.md", title: "Ch 1: Unix Foundation", desc: "argv, fd, pipe, fork, exec, wait — the surface layer" },
  { file: "notes/ch02_syscall_path.md", title: "Ch 2: Syscall Path", desc: "ecall, trapframe save, dispatcher, a0 return" },
  { file: "notes/ch03_address_translation.md", title: "Ch 3: Address Translation", desc: "Three-level page table walk, PTE flags, satp" },
  { file: "notes/ch04_traps_backtrace_alarm.md", title: "Ch 4: Traps & Alarm", desc: "Frame pointer walk, trapframe surgery, sigreturn" },
  { file: "notes/ch05_cow_fork.md", title: "Ch 5: COW Fork", desc: "Share-then-copy, refcounts, copyout trap" },
  { file: "notes/ch06_user_threads.md", title: "Ch 6: User Threads", desc: "14 callee-saved registers, cooperative switch, ret into another flow" },
  { file: "notes/ch07_net_driver.md", title: "Ch 7: Net Driver", desc: "TX/RX descriptor rings, DD bitmask, mbuf lifecycle" },
  { file: "notes/ch08_lock_lab.md", title: "Ch 8: Lock Lab", desc: "Per-CPU freelists, hash-partitioned bcache, steal protocol" },
  { file: "notes/ch09_filesystem.md", title: "Ch 9: Filesystem", desc: "Doubly-indirect bmap, itrunc freeing, symlink depth guard" },
  { file: "notes/ch10_mmap.md", title: "Ch 10: mmap", desc: "VMA lazy faults, filedup lifetime, partial unmap, dirty writeback" },
  { file: "notes/ch11_memory_order.md", title: "Ch 11: Memory Order", desc: "Store buffers, acquire/release fences, __sync_synchronize" },
  { file: "notes/LESSON_MAKING_GUIDE.md", title: "Lesson Making Guide", desc: "How each lesson is structured: state, blank, failure, code, grill" }
];

/* lesson grill questions */
const lessonGrills = {
  "unix-surface": [
    { q: "argv[0] = \"pingpong\", argv[1] = NULL. argc = ?",
      a: "1. argc always counts argv[0] (the program name). A no-arg program has argc==1, and argv[1] is NULL — so guard with argc<2 before touching argv[1], never argc==0." },
    { q: "pipe(p); fork(); parent close(p[1]); child close(p[0]); child write(p[1],\"x\",1); parent read(p[0],buf,1). Does read return 1 or block?",
      a: "Returns 1. The child's write puts 1 byte in the pipe buffer; the parent's read drains it. If the child had ALSO closed p[1] (its write end) without writing, AND the parent held no write end, read would return 0 (EOF). EOF needs ALL write ends closed." },
    { q: "strcmp(\"hello\",\"hello\") returns 0. \"hello\" == \"hello\" evaluates what?",
      a: "Compares two pointers (addresses of the string literals), NOT the bytes. May be 1 if the compiler pools identical literals, may be 0 if not — undefined to rely on. Always use strcmp; ==0 means equal there." }
  ],
  "syscall-path": [
    { q: "p->trapframe->a7 = 13 (pause). p->trapframe->a0 = 5. sys_pause returns 0. What does the user see in a0?",
      a: "0. The dispatcher does p->trapframe->a0 = syscalls[13](), overwriting the incoming 5 (the argument) with the return value 0. a0 is dual-use: argument IN, return value OUT." },
    { q: "mask = 0x20 (1<<5). num = 5. In C, mask & 1 << num evaluates as what — (mask & 1) << num or mask & (1 << num)?",
      a: "mask & (1 << num) = 0x20 & 0x20 = 0x20 (nonzero, true). << binds TIGHTER than &, so no parens needed here. The real trap is ==: 'mask & 1 == 0' parses as 'mask & (1==0)' = 'mask & 0' = 0 — always false." },
    { q: "argint(0,&fd) reads p->trapframe->a0. sigreturn restores a0=42 then returns 0. What does the user see in a0?",
      a: "0, not 42. The dispatcher overwrites a0 with sigreturn's return value (0) AFTER it runs. Fix: sigreturn must 'return p->trapframe->a0;' so the overwrite re-writes 42 over itself — a no-op that preserves the restored value." }
  ],
  "lookup-tree": [
    { q: "PTE = 0x8002_0043 (V=1,R=1,W=0,X=0). PTE2PA(PTE) = ?",
      a: "0x2000_8000. PTE2PA shifts right 10 (drop the 10 flag bits) then left 12: (0x80020043 >> 10) << 12. The low 10 bits (0x43 flags) are stripped; result is a 4096-aligned physical address." },
    { q: "walk returns &pagetable[PX(0,va)]. You do *pte = PA2PTE(pa) | perm. What happened to whatever was there?",
      a: "Silently overwritten. If the old PTE had V=1 it mapped a live page — you just leaked it and possibly aliased physical memory. That is why mappages refuses to remap a V=1 slot (panic 'remap')." },
    { q: "mappages panics if *pte & PTE_V. Why panic instead of overwriting?",
      a: "A V=1 slot means that virtual page is already mapped. Overwriting hides a double-map bug: two VAs to one frame, or a leaked frame. Panicking surfaces the logic error at the moment it happens instead of as later corruption." }
  ],
  "traps": [
    { q: "backtrace: fp = 0x3fffffe0, top = PGROUNDUP(fp) = 0x40000000. Loop runs while fp < top. Valid frame?",
      a: "Yes, 0x3fffffe0 < 0x40000000, so read *(fp-8) as the return address and fp = *(fp-16). The walk stops the instant fp reaches 0x40000000 (the page top) — the kernel stack is exactly one 4096-byte page." },
    { q: "alarm: p->interval=10, p->ticks=9, timer fires, p->alarm_on=0. What happens this tick?",
      a: "p->ticks becomes 10, hits interval, so: alarm_on=1, tf_backup=*trapframe (save ALL 32 regs incl epc), trapframe->epc=handler. On sret the user runs the handler. ticks resets to 0." },
    { q: "sigreturn copies tf_backup back to trapframe. If a second alarm fired DURING the handler, what would break?",
      a: "tf_backup would be overwritten with the handler's own context, losing the original. That is why alarm_on gates re-entry: while alarm_on==1 the timer branch is skipped, so no second save clobbers the saved frame. sigreturn clears alarm_on." }
  ],
  "cow": [
    { q: "refcount[pa]=2. parent writes to va->pa, PTE has PTE_COW, PTE_W=0. Trace the fault handler.",
      a: "scause=15 (store fault). Handler: kalloc a new frame, memmove 4096 bytes from pa, install new frame at va with PTE_W=1 and PTE_COW=0, then refcount[pa]-- (2->1). Parent now has a private writable copy; child still shares pa." },
    { q: "copyout(pagetable, useraddr, kbuf, n) where useraddr's page is COW read-only. Does a page fault fire?",
      a: "No — copyout is the KERNEL writing into user memory via the page table, not a CPU store through the MMU, so no store-fault traps. You must replicate COW logic inside copyout (walk the PTE, if COW do the copy) or the kernel write silently corrupts a shared page." },
    { q: "refcount[pa]=1, write fault. You just set PTE_W=1, clear PTE_COW, no kalloc. Why is skipping the copy correct?",
      a: "refcount==1 means this is the ONLY mapping of pa — nobody else shares it. Copying would waste a frame. Just restore write permission in place. Copy only when refcount>1." }
  ],
  "uthread": [
    { q: "thread_create sets t->ctx.ra = (uint64)func. What exactly happens on the first ret into this thread?",
      a: "uthread_switch loads ra=func then executes ret, so pc jumps to func's first instruction with a fresh sp. The s0-s11 in ctx are garbage but harmless — func's prologue overwrites them. func must call thread_exit, never return (ra below it is undefined)." },
    { q: "current_thread = next must run BEFORE uthread_switch. What breaks if you set it AFTER the switch call?",
      a: "The line after uthread_switch never runs for the NEW thread — the ret inside switch teleports pc to the new thread's saved ra, skipping the rest of thread_schedule. So current_thread stays stale (still the old thread), and the next schedule corrupts state." },
    { q: "Slot 0 is the scheduler. Workers start at slot 1. What goes wrong if a worker uses slot 0?",
      a: "Slot 0's context is the scheduler's own saved state (the main thread that called thread_schedule). Overwriting it loses the return path back to main, so when all workers exit there is nothing valid to switch back to." }
  ],
  "net": [
    { q: "tx_ring[i].status = 0x03, DD bit = 0x01. Is slot i reusable?",
      a: "Yes. Test the bit: 0x03 & 0x01 = 0x01 (nonzero) => DD set => card finished this slot => reusable. NEVER test status==1: 0x03!=1 would wrongly report 'busy' even though DD is set. Mask the one bit." },
    { q: "tx_mbufs[i] = 0x8002_0000, tx_ring[i].addr = 0x8002_0040. Which address goes to mbuffree?",
      a: "0x8002_0000 (tx_mbufs[i]) — the box START. addr (0x8002_0040) points at the DATA inside the box, 0x40 past the start. Freeing addr corrupts the allocator; you must free the chunk's beginning." },
    { q: "regs[E1000_TDT] = i. Is this a write to DRAM or to the card?",
      a: "To the CARD (a memory-mapped register over the bus, channel 2), not DRAM. It is the doorbell that wakes the card. Descriptor writes (tx_ring[i].*) go to DRAM silently; only the register write makes the card look. So it must come LAST, after a fence." }
  ],
  "lock-lab": [
    { q: "kfree pushes onto kmem[cpuid()]. Scheduler moves the flow from core 3 to core 5 between cpuid() and acquire. What breaks?",
      a: "id=3 is stale; you lock kmem[3] but are running on core 5, or worse two flows touch kmem[3] unsynchronized. The chunk lands on the wrong core's chain or a list is corrupted. Fix: push_off() around cpuid()+use pins the flow to its core." },
    { q: "Core A wants block 42 (42%13=3, lock3), Core B wants block 99 (99%13=8, lock8). Do they serialize?",
      a: "No — different buckets, different gate-cells. Both run fully parallel. That parallelism is exactly what bcachetest measures; one global lock would serialize them and fail the test." },
    { q: "bget miss: victim found in bucket 2, home bucket is 8. Which lock do you grab first, and why?",
      a: "lock2 first (lower index), then lock8. Every core grabs the lower-index bucket lock first, so two evictors can never each hold one and wait on the other — no deadlock cycle. After locking, re-check the victim is still refcnt==0; if not, rescan." }
  ],
  "filesystem": [
    { q: "inode has 11 direct + 1 singly-indirect (256) + 1 doubly-indirect. Max blocks? In bytes at BSIZE=1024?",
      a: "11 + 256 + 256*256 = 11 + 256 + 65536 = 65803 blocks = 65803*1024 = 67,382,272 bytes (~64 MB). The doubly-indirect entry is what lifts the limit from 268 blocks to 65803." },
    { q: "symlink target stored, open(\"b\") reads inode type T_SYMLINK. What does open do next, and what stops an A->B->A loop?",
      a: "It reads the path stored in the symlink's data block and re-resolves from there, looping. A depth counter caps follows at 10; on the 11th, return -1 (ELOOP). Without the cap, a cyclic symlink spins in the kernel forever." },
    { q: "itrunc frees the data blocks but forgets the L2 pointer blocks of the doubly-indirect tree. Exact symptom?",
      a: "A slow disk leak: one pointer block (1024 bytes) lost per 256 data blocks freed. The file's data is gone but the bitmap still marks those index blocks used; balloc eventually runs out though df shows space. Free L2 blocks AND the root." }
  ],
  "mmap": [
    { q: "mmap(...,MAP_SHARED, fd, 0); close(fd); then touch the page. Why does the access still work?",
      a: "mmap called filedup(f), bumping the file's refcount, so close(fd) only drops the fd-table slot — the VMA still holds a reference. The fault handler readi()'s from that file. Without filedup, close would free the file and the fault would read freed memory." },
    { q: "VMA covers va 0x4000..0x8000. munmap(0x5000, 0x1000) punches the middle. Allowed? How many VMAs after?",
      a: "Not allowed in the xv6 lab — munmap only shrinks from an end (prefix or suffix), never punches a hole. A middle unmap would require splitting one VMA into two; the lab's NVMA-slot model doesn't support it. Legal calls leave 1 VMA (shrunk)." },
    { q: "MAP_SHARED page was faulted in, written, marked dirty. When do the bytes reach the file?",
      a: "At munmap (or process exit): walk the mapped pages, and for each dirty page in a MAP_SHARED region, writei() it back to the file at offset (va - vma->addr + vma->offset). MAP_PRIVATE pages are never written back — changes are discarded." }
  ],
  "memory-barrier": [
    { q: "T0: x=1; fence; y=1;  T1: while(y==0){} print x;  Without T0's fence, T1 can print 0. By what mechanism?",
      a: "T0's stores sit in a store buffer / can be reordered, so y=1 can become visible to T1 before x=1 does. T1 sees y==1, exits the loop, reads the still-old x=0. The fence forces x=1 to be globally visible before y=1." },
    { q: "acquire() does the test-and-set, THEN __sync_synchronize(). Why is the fence AFTER the lock is taken, not before?",
      a: "To stop loads/stores inside the critical section from being hoisted ABOVE the lock acquisition. The fence after acquire pins all protected accesses to happen after you own the lock. (acquire-semantics: nothing moves up past it.)" },
    { q: "release() does __sync_synchronize() BEFORE writing locked=0. Why before, not after?",
      a: "To force every store inside the critical section to be globally visible BEFORE the lock is released. If locked=0 became visible first, another core could acquire and read half-written data. (release-semantics: nothing moves down past it.)" }
  ]
};

/* assignment title -> lab link mapping */
const assignmentLabMap = {
  A1: "unix-surface", A2: "syscall-path", A3: "lookup-tree", A4: "traps",
  A5: "cow", A6: "uthread", A7: "net", A8: "lock-lab", A9: "filesystem", A10: "mmap", A11: "memory-barrier"
};

/* -- render functions --------------------------------------------------- */

function renderModules() {
  const root = document.getElementById("courseTimeline");
  modules.forEach((item, index) => {
    const card = el("article", "module-card");
    card.appendChild(el("div", "number", String(index + 1).padStart(2, "0")));
    card.appendChild(el("h3", "", item.title));
    card.appendChild(el("p", "", item.short));
    const trap = el("p", "", `Trap: ${item.trap}`);
    card.appendChild(trap);
    const tags = el("div", "tags");
    item.tags.forEach((tag) => tags.appendChild(el("span", "tag", tag)));
    card.appendChild(tags);
    root.appendChild(card);
  });
}

function renderLessons(activeId = lessons[0].id) {
  const list = document.getElementById("lessonList");
  const view = document.getElementById("lessonView");
  list.innerHTML = "";

  const progress = getProgress();
  lessons.forEach((lesson) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.lessonId = lesson.id;
    let cls = lesson.id === activeId ? "active" : "";
    if (progress[lesson.id]) cls += " read";
    button.className = cls;
    button.innerHTML = `${lesson.title}<small>${lesson.subtitle}</small>`;
    button.addEventListener("click", () => {
      history.replaceState(null, "", `#lesson-${lesson.id}`);
      renderLessons(lesson.id);
      view.focus();
    });
    list.appendChild(button);
  });

  const lesson = lessons.find((entry) => entry.id === activeId) || lessons[0];
  view.innerHTML = "";
  view.appendChild(el("p", "eyebrow", `${lesson.level} lesson`));
  const titleRow = el("div", "lesson-title-row");
  titleRow.appendChild(el("h3", "", lesson.title));
  if (labLinks[lesson.id]) {
    const labLink = el("a", "lab-link", "MIT Lab Spec");
    labLink.href = labLinks[lesson.id];
    labLink.target = "_blank";
    titleRow.appendChild(labLink);
  }
  if (noteLinks[lesson.id]) {
    const noteLink = el("a", "lab-link", noteLinks[lesson.id].label);
    noteLink.href = noteLinks[lesson.id].file;
    noteLink.target = "_blank";
    titleRow.appendChild(noteLink);
  }
  view.appendChild(titleRow);
  view.appendChild(el("p", "", lesson.summary));

  view.appendChild(el("h4", "", "Machine Picture"));
  view.appendChild(el("pre", "", lesson.diagram.trim()));

  view.appendChild(el("h4", "", "Beats"));
  const beatList = el("ul");
  lesson.beats.forEach((beat) => beatList.appendChild(el("li", "", beat)));
  view.appendChild(beatList);

  view.appendChild(el("h4", "", "Fill-In Blanks"));
  const blankList = el("ul", "blank-list");
  lesson.blanks.forEach((blank) => {
    const li = el("li");
    const prompt = el("code");
    prompt.textContent = blank.prompt;
    li.appendChild(prompt);
    const reveal = document.createElement("button");
    reveal.className = "reveal-btn";
    reveal.textContent = "Show answer";
    reveal.type = "button";
    const ans = el("span", "blank-answer hidden");
    ans.textContent = blank.answer;
    reveal.addEventListener("click", () => {
      ans.classList.toggle("hidden");
      reveal.textContent = ans.classList.contains("hidden") ? "Show answer" : "Hide";
    });
    li.appendChild(document.createElement("br"));
    li.appendChild(reveal);
    li.appendChild(ans);
    blankList.appendChild(li);
  });
  view.appendChild(blankList);

  /* mark lesson as read */
  markRead(lesson.id);

  view.appendChild(el("h4", "", "Assembled Code"));
  view.appendChild(el("pre", "", lesson.code.trim()));

  /* grill questions */
  if (lessonGrills[lesson.id]) {
    view.appendChild(el("h4", "", "Grill (answer in real numbers)"));
    const grillList = el("ol", "grill-list");
    lessonGrills[lesson.id].forEach((grill) => {
      const li = el("li", "grill-item");
      li.appendChild(el("span", "grill-q", grill.q));
      if (grill.a) {
        const reveal = document.createElement("button");
        reveal.className = "reveal-btn";
        reveal.type = "button";
        reveal.textContent = "Show answer";
        const ans = el("span", "blank-answer hidden");
        ans.textContent = grill.a;
        reveal.addEventListener("click", () => {
          ans.classList.toggle("hidden");
          reveal.textContent = ans.classList.contains("hidden") ? "Show answer" : "Hide";
        });
        li.appendChild(document.createElement("br"));
        li.appendChild(reveal);
        li.appendChild(ans);
      }
      grillList.appendChild(li);
    });
    view.appendChild(grillList);
  }
}

function renderAssignments() {
  const root = document.getElementById("assignmentGrid");
  assignments.forEach((item) => {
    const card = el("article", "assignment");
    const titleRow = el("div", "assignment-title-row");
    titleRow.appendChild(el("h3", "", item.title));
    
    const prefix = item.title.split(" ")[0];
    if (assignmentLabMap[prefix] && labLinks[assignmentLabMap[prefix]]) {
      const link = el("a", "lab-link-small", "Lab Spec");
      link.href = labLinks[assignmentLabMap[prefix]];
      link.target = "_blank";
      titleRow.appendChild(link);
    }
    
    card.appendChild(titleRow);
    card.appendChild(el("p", "", item.output));
    card.appendChild(el("strong", "", `Proof: ${item.proof}`));
    const ul = el("ul");
    item.traps.forEach((trap) => ul.appendChild(el("li", "", trap)));
    card.appendChild(ul);
    root.appendChild(card);
  });
}

// FIX: paths are local filesystem references, not web URLs
// Rendering as plain <code> instead of broken <a> tags
function renderCodeAudit() {
  const root = document.getElementById("codeAudit");
  localCode.forEach((item) => {
    const card = el("article", "code-card");
    card.appendChild(el("span", "status", item.status));
    card.appendChild(el("h3", "", item.assignment));
    const path = el("p");
    path.innerHTML = `<strong>Where:</strong> <code class="code-path">${escapeHtml(item.path)}</code>`;
    card.appendChild(path);
    card.appendChild(el("p", "", item.proof));
    root.appendChild(card);
  });
}

let drillIndex = 0;

function renderDrill(show = false) {
  document.getElementById("drillQuestion").textContent = drills[drillIndex].q;
  const answer = document.getElementById("drillAnswer");
  answer.textContent = drills[drillIndex].a;
  answer.hidden = !show;
}

function renderStyle() {
  const root = document.getElementById("styleGrid");
  styleRules.forEach((rule) => {
    const card = el("article", "style-card");
    card.appendChild(el("h3", "", rule.title));
    card.appendChild(el("p", "", rule.text));
    root.appendChild(card);
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initRouting() {
  const hash = window.location.hash.replace("#lesson-", "");
  if (lessons.some((lesson) => lesson.id === hash)) {
    renderLessons(hash);
    document.getElementById("lessons").scrollIntoView();
  } else {
    renderLessons();
  }
}

/* -- event listeners ---------------------------------------------------- */

document.getElementById("prevDrill").addEventListener("click", () => {
  drillIndex = (drillIndex - 1 + drills.length) % drills.length;
  renderDrill(false);
});

document.getElementById("nextDrill").addEventListener("click", () => {
  drillIndex = (drillIndex + 1) % drills.length;
  renderDrill(false);
});

document.getElementById("showAnswer").addEventListener("click", () => {
  const answer = document.getElementById("drillAnswer");
  renderDrill(answer.hidden);
});

/* -- progress tracking -------------------------------------------------- */

function getProgress() {
  try { return JSON.parse(localStorage.getItem("os_progress") || "{}"); }
  catch { return {}; }
}

function markRead(lessonId) {
  const p = getProgress();
  p[lessonId] = true;
  localStorage.setItem("os_progress", JSON.stringify(p));
  updateProgressBadges();
}

function updateProgressBadges() {
  const p = getProgress();
  document.querySelectorAll(".lesson-list button").forEach((btn) => {
    const id = btn.dataset.lessonId;
    if (id && p[id]) btn.classList.add("read");
  });
  const total = lessons.length;
  const done = lessons.filter((l) => p[l.id]).length;
  let badge = document.getElementById("progressBadge");
  if (!badge) {
    badge = el("span", "progress-badge");
    badge.id = "progressBadge";
    document.querySelector(".proof-strip").appendChild(badge);
  }
  badge.textContent = `${done}/${total} lessons read`;
}

/* -- render notes ------------------------------------------------------- */

function renderNotes() {
  const root = document.getElementById("notesGrid");
  if (!root) return;
  allNotes.forEach((note) => {
    const card = el("article", "code-card");
    const link = document.createElement("a");
    link.href = note.file;
    link.target = "_blank";
    link.className = "note-title-link";
    link.textContent = note.title;
    card.appendChild(link);
    card.appendChild(el("p", "", note.desc));
    const dl = el("a", "lab-link-small", "Open markdown");
    dl.href = note.file;
    dl.target = "_blank";
    card.appendChild(dl);
    root.appendChild(card);
  });
}

/* -- init --------------------------------------------------------------- */

renderModules();
initRouting();
renderAssignments();
renderCodeAudit();
renderDrill(false);
renderStyle();
renderNotes();
updateProgressBadges();
