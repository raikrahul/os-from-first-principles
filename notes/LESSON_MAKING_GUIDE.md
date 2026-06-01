LESSON MAKING GUIDE
How to turn any chat into a lesson file in this exact style.
Feed this whole file to an assistant with a raw chat and say: "make a lesson file
from this chat using this guide."

================================================================================
WHO THE LEARNER IS  (write for this person, not a general audience)
================================================================================
- Calls self a "primate": knows counting, arithmetic, comparisons, coding basics,
  some math. Assumes NOTHING above that. Every concept built from those.
- Severe ADHD. Mind wanders the instant a line is not a direct instruction.
  Loses focus on prose. Skips to the end. Reads English, skips the math.
- Habit: learns only the surface, memorizes, fails exams, never reaches the core
  of a problem. Gets stuck on starting/trivial details, exhausts, quits.
- So: do NOT ask to "think". Ask to DO, CALCULATE, FILL. Give the meat first,
  cut the warm-up. Make the learner produce the number, not read it.
- Wants raw brute force over English. Less teaching, more exercise.
- Endpoint: pass a hard interviewer. Each lesson ends with a question the learner
  must answer in real numbers/bytes, not words.

================================================================================
HARD RULES  (every one of these was demanded; breaking any = rejected file)
================================================================================
AXIOM CHAIN
  1. Line N uses only lines 1..N-1. No forward references. No "we will see later".
  2. No new word/number/formula/address on a line before an earlier line builds
     it. If line N uses value X, an earlier line computed X. Same for a formula
     or an address.
  3. Line 1 = a first fact with no dependency.
  4. At the end, the file must contain ZERO "new things introduced without
     derivation". If the list is non-empty, the file is rejected.

NUMBERS, NOT VARIABLES
  5. Use real numbers the learner can verify, not symbols. Not "address A" —
     write 0x80000. Not "n bytes" — write 74.
  6. Every address is computed from 0 + sizes. Never invent an address as if it
     were derived. If a number is simply given (a chip constant), say "a given".
  7. Make the learner calculate. Leave a blank "= ____" then the answer in
     parentheses on the same or next line. The learner fills before peeking.

PURE ASCII
  8. Pure ASCII drawings. No LaTeX, no fancy rendering, no unicode math.
  9. Draw the data structure populated with real data BEFORE each step that uses
     it. Show the bytes/cells changing.
  10. Diagrams must be discrete and non-intersecting. Box-and-arrow, columns,
      rows. One state per drawing.

NO NOISE  (these exact things disturb flow — never emit them)
  11. No headings inside a lesson (no "PART A:", no "## Section"). One top line
      naming the chapter is enough.
  12. No line-labels: no "CALC.", "FILL.", "TRACE.", "NOTE.", "PRINCIPLE.".
      Pose the line bare.
  13. No inline cross-refs like "(CH01 L10)" or "(L5)" inside sentences. State
      the dependency in plain words ("from the earlier free-list:") or list all
      dependencies once at the top.
  14. No quiz-item labels ("G1.", "Q2."). List questions bare; answers in the
      same order below.
  15. No phrases like "(after the mechanism)", "as mentioned below", "as we saw".
  16. Least adjectives. Least adverbs. Fewest words. No stories. No greetings.
      No summaries. No motivational filler.

WHAT TO TEACH
  17. Teach the OS principle, not just the lab steps. The "why this exists" goes
      INSIDE the numbered steps, in plain words, not a prose preamble.
  18. Teach edge cases, tests, flows, and breaking points — what an interviewer
      probes — not definitions. The learner does not need to know what an OS is;
      the learner needs the traps and the failure modes.
  19. Name the real jargon (page table, mutex, inode, syscall) ONLY at the very
      end, after the mechanism is built. Never lead with the name.

ERRORS
  20. When the learner is wrong, give one orthogonal correction (a different
      angle than their wrong reasoning), terse, in plain text. Not a line-by-line
      debug dump. Document mistakes in a MISTAKES.md as a plain list of errors.

================================================================================
BANNED WORDS  (derive the mechanism in real numbers FIRST, then the name is ok
as shorthand; full lists live in interview_systems/CLAUDE.md and
stanford140_fs/CLAUDE.md)
================================================================================
Synchronization: lock, mutex, semaphore, atomic, spinlock, futex, RCU.
Memory: virtual memory, paging, page, frame, TLB, page fault, page table,
  mmap, dirty page, address (use "place-number"), pointer (use "8-byte
  name-of-a-place"), RAM/DRAM (use "the working bytes").
Chip: CPU, core, silicon, processor, hart (use "the thing that fetches the next
  4-byte instruction at the place named by a counter and does what the bits say").
Kernel: kernel, userspace, syscall, process, task, thread, fork, exec, wait,
  signal, interrupt, scheduler, context switch, ring/kernel mode (use "the mode
  bit"; flip it via the doorway instruction).
Filesystem: block, sector, inode, dentry, superblock, journal, fsync, B-tree.
DSA: array, struct, pointer, function, loop, list, node, queue, stack, hash
  table, tree, iterate, traverse, recurse, algorithm.
Also banned as substitutes: "silicon", raw byte-offsets quoted as authority
  (derive by counting 8-byte slots), C struct names, register codes (a0, sepc,
  satp — name by purpose), the word "call".
Substrate the learner already has (free to use): counting, bit (0/1), byte
  (8 bits, 0..255), hex, exponent, memory as numbered byte-cells, a named cell
  inside the chip (8 bytes), one instruction then the next, a place-number,
  file as a byte stream, disk as numbered fixed-size blocks, time as a tick count.

================================================================================
THE FILE FORMAT  (copy this skeleton)
================================================================================
Line 1: CHNN TITLE. USES <earlier chapters and the exact terms borrowed>.
        EACH LINE USES ONLY EARLIER LINES.

Then numbered steps L1, L2, ... Each step:
  - states one fact or one action, using only earlier steps,
  - shows a populated ASCII drawing when state changes,
  - poses at least one "= ____" blank with the answer in parentheses.

Then a GRILL block: the word GRILL on its own line, then bare questions (no
labels), then a blank line, then the answers in the same order (no labels).
All grill answers are numbers or one-word (yes/no), never prose.

Then a NAMES block: the word NAMES on its own line, then "our-term = real-jargon"
pairs. This is the ONLY place jargon appears.

================================================================================
WORKED SKELETON  (fill the brackets)
================================================================================

CH09 FILE SYSTEM. USES CH01 (byte, hex, place-number, 8-byte record) and CH08
(disk = numbered 1024-byte blocks). EACH LINE USES ONLY EARLIER LINES.

L1. <first fact, no dependency or only CH01/CH08 terms>. <real numbers>.
   <ascii drawing populated with real data if state exists>
   <number> = ____   (<answer>)

L2. <next fact, uses only L1 + the top terms>.
   <drawing>
   <blank>   (<answer>)

L3. <action with before/after drawing>
   before:  [ field=val  field=val ]
   after:   [ field=val' field=val ]
   <blank>   (<answer>)

...continue until the mechanism is complete...

================================================================================
GRILL
<bare question 1, answerable in a number>
<bare question 2>
<bare question 3>

<answer 1>
<answer 2>
<answer 3>
================================================================================
NAMES.
 <our-term> = <real jargon>
 <our-term> = <real jargon>
================================================================================

================================================================================
PROCEDURE: CHAT -> LESSON  (what the assistant does)
================================================================================
1. Read the chat. Find the one mechanism it teaches. Ignore side-talk.
2. List the substrate terms the mechanism needs. If a term is above the learner's
   base (banned list), schedule it as an earlier L-line or cite an earlier
   chapter in the top USES line.
3. Order the facts so line N needs only lines 1..N-1. Reorder the chat's content
   to obey this; the chat order does not matter.
4. Replace every symbol with a real number. Compute every address from 0+sizes.
5. Draw each state in pure ASCII with those numbers, before the step that uses it.
6. Convert each "you should understand X" into a "= ____" the learner computes.
7. Strip all noise (rules 11-16).
8. Write the GRILL from the breaking points and edge cases in the chat.
9. Write NAMES last, mapping every invented term to its real jargon.
10. Self-check: scan for any term used before its derivation. List them. If the
    list is non-empty, fix and rescan. Only a clean scan ships.
11. Append any learner misconceptions found to MISTAKES.md as a plain error list.

================================================================================
SELF-CHECK CHECKLIST  (run before declaring a lesson done)
================================================================================
[ ] line 1 has no dependency beyond the top USES line
[ ] every later line uses only earlier lines
[ ] every address computed from 0 + sizes, or marked "a given"
[ ] every symbol replaced by a real number
[ ] a populated ASCII drawing precedes each state-changing step
[ ] no headings, no CALC/FILL/TRACE labels, no inline (CHxx Lyy) refs
[ ] no Gn. quiz labels; questions and answers aligned by position
[ ] banned jargon appears only in the closing NAMES block
[ ] GRILL answers are numbers / yes-no, not prose
[ ] OS principle taught (the why), not only the lab steps
[ ] mistakes appended to MISTAKES.md
[ ] final scan: NEW THINGS INTRODUCED WITHOUT DERIVATION = (empty)
================================================================================
