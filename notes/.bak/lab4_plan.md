# Lab 4 — Traps (Plan)

## Status
- Branch: `trap` (already exists)
- Prereq: Lab 1 (util), Lab 2 (syscall), Lab 3 (pgtbl) all complete on their branches.

## Tasks (3 of them)

### Task A — RISC-V Assembly Reading
- No code to write; just questions about `user/call.c` and its compiled assembly.
- Purpose: learn the RISC-V calling convention (arg regs, return regs,
  callee-saved vs caller-saved, where the return-address lives).
- Submit answers as `answers-traps.txt`.

### Task B — Backtrace
- Write `void backtrace(void)` in `kernel/printf.c`.
- Walks up the kernel stack reading each frame's saved return-address; prints them.
- Useful debugging tool — when the kernel panics, you can see the call chain.
- Call it from `sys_sleep()` so it fires when the test program runs.

### Task C — Alarm
- Add two new operations:
  - `sigalarm(int interval, void (*handler)())` — every `interval` ticks, call `handler` once.
  - `sigreturn()` — called by the handler when done; restores normal user execution.
- Files touched: `kernel/proc.h` (per-task fields), `kernel/sysproc.c` (handlers),
  `kernel/trap.c` (timer-interrupt logic), `kernel/syscall.c` + `kernel/syscall.h`
  + `user/usys.pl` + `user/user.h` (boilerplate for the two new ops).
- User test programs are provided (`alarmtest`).

## Order
Recommended:
1. Task A first (no code, fast warm-up; refreshes calling convention).
2. Task B second (small, self-contained; teaches frame walking).
3. Task C last (most intricate; touches trap.c + trapframe surgery).

## Substrate to derive BEFORE writing code
- RISC-V calling convention: which regs are caller-saved (a0-a7, t0-t6, ra)
  vs callee-saved (s0-s11, sp).
- Stack frame layout: prev-fp at offset -16 from current fp; ra at offset -8.
  (Verify by reading kernel.asm for any function.)
- Trapframe layout: 288 storage units, slots for all 31 user regs +
  kernel bookkeeping (already seen in Lab 2).
- Timer interrupt: fires every tick (10 ms). Lands in `usertrap()` or
  `kerneltrap()`. `which_dev == 2` flag indicates timer.

## Testing
```bash
cd labs/xv6-new
rm -f fs.img
make qemu
```

Test programs (provided by lab repo or written for the lab):
- `bttest` — calls sys_sleep which now also calls backtrace; expect a list of
  saved return-addresses to print.
- `alarmtest` — tests Task C in several scenarios (handler called regularly;
  sigreturn restores correctly; works across multiple alarms).

## Lessons (see `lab4_lesson.md`)
- Lesson 1: RISC-V calling convention + register save/restore.
- Lesson 2: Stack frames and how to walk them.
- Lesson 3: Trapframe surgery — redirecting user PC by modifying epc.
- Lesson 4: Restoring state via saved trapframe (sigreturn).

## Hooks (where code goes)

| File | Function | What |
|---|---|---|
| kernel/printf.c | backtrace (new) | Walk the kernel stack via fp chain; print ra of each frame. |
| kernel/sysproc.c | sys_sleep | Call backtrace() at entry. |
| kernel/riscv.h | r_fp helper (new) | Inline assembly to read s0/fp register. |
| kernel/proc.h | struct proc | Add fields: int alarm_interval, void *alarm_handler, int alarm_ticks, struct trapframe *saved_tf, int in_handler. |
| kernel/proc.c | allocproc, freeproc | Initialize and clean up the alarm fields. |
| kernel/syscall.h | new defines | SYS_sigalarm 22, SYS_sigreturn 23 (or next free). |
| kernel/syscall.c | extern + array entry | Add sys_sigalarm and sys_sigreturn to dispatcher. |
| kernel/sysproc.c | sys_sigalarm, sys_sigreturn (new) | Implement the two operations. |
| kernel/trap.c | usertrap | On timer tick, count down alarm_ticks; on expiry, save trapframe and redirect epc to handler. |
| user/user.h | prototypes | int sigalarm(int, void(*)()); int sigreturn(void); |
| user/usys.pl | entry | entry("sigalarm"); entry("sigreturn"); |

## Things to verify after each task
- After Task B: kernel panics print a sensible call chain.
- After Task C: alarmtest passes all scenarios; user state is preserved
  across handler calls (regs same before/after).

## Common pitfalls
- Forgetting that ra is at fp-8 and prev-fp is at fp-16 (these are negative
  offsets from the current fp, not positive).
- In backtrace: stop when fp reaches the top of the kernel stack
  (PGROUNDUP(fp) - fp pattern). Otherwise you read past the stack into
  garbage memory and either fault or print junk.
- In Task C: forgetting to save ALL user regs (not just epc) in
  saved_trapframe. Handler might clobber a-regs, s-regs, etc., before
  calling sigreturn.
- In Task C: forgetting to handle the case "handler called sigreturn
  while in_handler=0" (user called sigreturn without going through alarm).
  Could panic or just return -1.
- Double alarm: if a second timer fires while the handler is running,
  you must NOT redirect again (would lose the saved_trapframe). Use an
  in_handler flag.
