# Lab 4 — Traps (Lesson)

## Lesson 1: RISC-V Calling Convention

### What gets passed in which named cell

When function `caller()` calls `callee(a, b, c)`:

```
caller:
   load a into named cell `a0`
   load b into named cell `a1`
   load c into named cell `a2`
   call callee        ← writes return-position into `ra`, jumps to callee
callee:
   ... runs ...
   load result into `a0`
   ret                ← reads `ra`, jumps there
```

| Named cell | Role |
|---|---|
| a0..a7 | First 8 args. Result returns in a0 (a1 for second result). |
| ra | Return-address — where to jump back when this function exits. |
| sp | Stack-pointer — top of the current frame's stack. |
| s0 / fp | Frame-pointer — start of the current function's stack frame. |
| s1..s11 | Other callee-saved cells. |
| t0..t6 | Caller-saved temporaries. |

### Caller-saved vs callee-saved

- **Caller-saved (a0..a7, t0..t6, ra):** caller must save these before calling
  if it cares about their value after. Callee is free to clobber.
- **Callee-saved (s0..s11, sp):** callee must save (and restore) these if it
  changes them. Caller can assume they're unchanged across the call.

### Why this matters for Lab 4

- Backtrace reads `s0` (= fp) to find the current frame, then walks up.
- Alarm's handler runs as if a function call — but the kernel must save
  enough state for sigreturn to restore. The trapframe already saves all
  31 user-mode integer cells, so saving the entire trapframe covers it.

## Lesson 2: Stack Frames and Walking Them

### Per-function frame layout (set up by the compiler at function entry)

```
high addresses

   ┌─────────────────────────────┐
   │ <caller's frame above>      │
   ├─────────────────────────────┤  ← caller's sp before call
   │ saved ra                    │     (this function's return-address)
   │ (8 storage units)           │
   ├─────────────────────────────┤  ← fp points HERE  (= caller's sp - 0)
   │                             │
   │ saved prev-fp               │
   │ (8 storage units)           │
   ├─────────────────────────────┤  ← fp - 16
   │ saved s1                    │
   │ saved s2                    │
   │ ... other callee-saved      │
   ├─────────────────────────────┤
   │ local variables             │
   │ ...                         │
   ├─────────────────────────────┤  ← sp (current top of stack)
low addresses
```

Two fixed positions in every frame:
- **ra at fp - 8**: where this function returns to.
- **prev-fp at fp - 16**: pointer to the caller's frame.

### Walking the stack

```c
uint64 fp = r_fp();   // read current fp (s0)
while (fp is still inside the kernel stack) {
    uint64 ra      = *(uint64 *)(fp - 8);
    uint64 prev_fp = *(uint64 *)(fp - 16);
    print ra;
    fp = prev_fp;
}
```

### Bounding the walk

Kernel stacks are one chunk (4096 storage units). To stop the walk at the
top of the stack:

```c
uint64 stack_top = PGROUNDUP(fp);     // top of this stack chunk
while (fp < stack_top) {
    ...
    fp = *(uint64 *)(fp - 16);
}
```

When prev-fp reaches or exceeds stack_top, we've walked past the first
function in the kernel call chain. Stop.

### Drawing for a 3-deep call: usertrap → syscall → sys_sleep

```
KERNEL STACK (one 4096-unit chunk for this task)

high addresses (top of stack chunk = PGROUNDUP(any fp in this chunk))

   ┌─────────────────────────────────────┐
   │ (unused above usertrap's frame)     │
   ├─────────────────────────────────────┤
   │ usertrap's saved ra                 │   ← came from forkret/userret area
   │ usertrap's saved prev-fp            │
   │ usertrap's local vars               │
   ├─────────────────────────────────────┤
   │ syscall's saved ra                  │   ← address inside usertrap
   │ syscall's saved prev-fp             │   ← points up to usertrap's frame
   │ syscall's local vars                │
   ├─────────────────────────────────────┤
   │ sys_sleep's saved ra                │   ← address inside syscall
   │ sys_sleep's saved prev-fp           │   ← points up to syscall's frame
   │ sys_sleep's local vars              │
   ├─────────────────────────────────────┤  ← fp register points HERE (sys_sleep's frame)
                                            (= sp at sys_sleep entry)

low addresses

Walking from fp:
  Read *(fp - 8)  → sys_sleep's saved ra (address in syscall)
  Read *(fp - 16) → syscall's frame.
  fp = syscall's frame.
  Read *(fp - 8)  → syscall's saved ra (address in usertrap)
  Read *(fp - 16) → usertrap's frame.
  fp = usertrap's frame.
  Read *(fp - 8)  → usertrap's saved ra
  Read *(fp - 16) → (out of stack chunk → stop)
```

Prints 3 addresses. Pipe through `addr2line` to convert to file:line.

## Lesson 3: Trapframe Surgery (for Alarm)

### Trapframe layout reminder

Per-task chunk, 288 storage units, holding saved user regs + kernel
bookkeeping. Lives at fixed VA = TRAPFRAME (= MAXVA - 2*PGSIZE) in user
tree.

```
Trapframe (per task):
   bookkeeping (5 cells × 8 units = 40 units)
   epc                           ← saved user PC (where to resume)
   kernel_hartid
   ra, sp, gp, tp, t0..t6, s0..s11, a0..a7
   = 31 user-mode integer cells
```

After a trap, `trapframe->epc` holds the user PC at the trap moment.
Trap-return loads PC = trapframe->epc.

### Redirecting user execution via trapframe surgery

To make user-mode start executing function `handler()` instead of resuming
where they were:

```c
p->saved_tf = copy of *(p->trapframe);    // save full current state
p->trapframe->epc = (uint64) handler;     // redirect epc
// (leave a0..a7 etc. alone — handler is a void-returning function with
//  no args, so they don't matter at entry. But sigreturn must restore
//  everything for the post-handler resume.)
```

Trap-return runs. User now executes handler() instead of their old PC.

### Restoring after handler (sigreturn)

User's handler calls sigreturn() at the end. sigreturn:

```c
*(p->trapframe) = p->saved_tf;            // restore full state
p->in_handler = 0;
return p->trapframe->a0;                  // preserve a0 in handler return path
```

Trap-return runs. User now resumes at the original PC (saved in epc),
with all original regs restored.

### Drawing for alarm flow

```
─── User running normally ──────────────────────────────────

   user PC = 0x1234 (in some user function "foo")
   user regs: a0..a7 = (whatever foo's been computing)


─── Timer interrupt fires (assume alarm_ticks expired) ─────

   usertrap saves user state to trapframe automatically:
     trapframe->epc = 0x1234
     trapframe->a0  = (foo's a0)
     trapframe->...  = (foo's other regs)

   usertrap detects alarm should fire:
     p->saved_tf = *(p->trapframe);      ← BACKUP
     p->trapframe->epc = (uint64)handler;
     p->in_handler = 1;
     p->alarm_ticks = 0;


─── Trap-return: user runs handler() ────────────────────────

   user PC = address of handler
   handler runs ... ... calls sigreturn() at end.


─── sigreturn syscall fires ────────────────────────────────

   sys_sigreturn:
     *(p->trapframe) = p->saved_tf;      ← RESTORE
     p->in_handler = 0;
     return p->trapframe->a0;            ← preserve a0 (would otherwise
                                            be clobbered by the syscall's
                                            return value path)


─── Trap-return again: user resumes "foo" ──────────────────

   user PC = 0x1234 (back where it was when interrupted)
   user regs: a0..a7 = (foo's original values, fully restored)
   foo continues as if nothing happened.
```

## Lesson 4: Common Traps and Gotchas

### Gotcha 1: a0 clobbered by syscall return path

When sigreturn returns, the kernel's syscall dispatcher writes the return
value into `p->trapframe->a0` AFTER your sys_sigreturn function returns
(see `syscall()` in syscall.c line ~141). This would overwrite the
restored a0 with whatever sys_sigreturn returns.

Fix: have sys_sigreturn return `p->trapframe->a0` itself. The syscall
dispatcher's write becomes a no-op (writing the same value).

### Gotcha 2: Double-alarm during handler

If timer fires AGAIN while the handler is running, you must NOT
re-redirect. Use `p->in_handler` flag — only fire if NOT in handler.

### Gotcha 3: Walking past the kernel stack in backtrace

Kernel stack is one 4096-unit chunk. If you don't bound the walk,
`fp = *(fp - 16)` will eventually point at garbage outside the stack,
causing a page fault or printing junk.

Use `PGROUNDUP(fp)` as the upper bound. Stop when fp >= PGROUNDUP(start_fp).

### Gotcha 4: backtrace's fp register

s0 is also fp. Read it via inline assembly:
```c
static inline uint64
r_fp(void)
{
  uint64 x;
  asm volatile("mv %0, s0" : "=r" (x));
  return x;
}
```
Put this in riscv.h alongside r_satp and friends.

## Anti-skim grill

1. What does PGROUNDUP do to a value that's already a multiple of 4096?
   (Answer: returns it unchanged. PGROUNDUP only rounds UP if not already
   on a boundary.)

2. In backtrace, why does fp - 16 (not fp + 16) give the previous frame?
   (Answer: the stack grows DOWN — high addresses are older frames.
   Going up the stack = going to higher addresses = subtracting from fp.)

3. In alarm, why must sigreturn return the saved a0 value, not just 0?
   (Answer: the syscall dispatcher overwrites trapframe->a0 with the
   handler's return value AFTER your function returns. Returning the
   already-restored a0 makes that overwrite a no-op.)

4. What happens if the user calls sigreturn() without ever calling
   sigalarm() or before the handler is invoked?
   (Answer: there's no saved_tf to restore from. Common implementations
   either panic, return -1, or fault. Cleanest: check `if (!p->in_handler)
   return -1;`.)
