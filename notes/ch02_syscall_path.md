CH02 SYSCALL PATH. USES ONLY CH01 (bit, byte, hex, exponent, memory+place
number, register 8 bytes, PC, PC+4, jump). EACH LINE USES ONLY EARLIER LINES.

L1. From CH01: PC is a register (8 bytes), holds an address, step is PC+4, a
 jump sets PC to a chosen number. Restate one jump:
 PC=4096 -> jump 8192 -> PC=8192.

L2. Add one bit (holds 0 or 1). Name it MODE.
 MODE = [0] or MODE = [1]

MODE can hold 2? ____ (no, a bit is 0 or 1)

L3. Impose a rule. Split addresses into two ranges using a cut
 number C. Pick C = 8192 (CH01 hex "2000" = 8192).
 addresses 0..8191 : any MODE may read/write
 addresses 8192..big : only MODE=1 may read/write

address 9000, MODE=0, allowed? ____ (no, 9000 >= 8192 and MODE=0)
address 4096, MODE=0, allowed? ____ (yes, 4096 < 8192)

L4. Your program runs with MODE=0 (PC started at 4096, which is < 8192,
 so program lives in the low range). Disk-driver instructions live at 8192+
 (high range). So the program cannot jump into them: a jump to
 8192 while MODE=0 is refused by the L3 rule.

program MODE=0 jumps to 8192. lands there? ____ (no, refused by L3)

L5. One instruction is exempt. Name it DOOR. DOOR may flip MODE but may NOT pick
 the target. It forces PC to a fixed number held in a register.
 Name that register TVEC. Set TVEC = 8192 (a given, like CH01 set PC=4096).

 TVEC = 8192

L6. DOOR does exactly three number changes. Name a register EPC (8
 bytes) to remember the old PC.
 change 1: EPC = PC
 change 2: MODE = 1
 change 3: PC = TVEC

 before DOOR: PC=4096, MODE=0, TVEC=8192, EPC=anything
 after DOOR: EPC=4096, MODE=1, PC=8192

after DOOR, EPC = ____ (4096, change 1 copied old PC)
after DOOR, MODE = ____ (1)
after DOOR, PC = ____ (8192, = TVEC)

L7. DOOR touched only EPC, MODE, PC. It wrote 0 bytes of the program's
 other registers to memory. Say the chip has 32 registers (each 8
 bytes). All 32 still hold the program's numbers.

registers DOOR saved to memory = ____ (0)
registers still holding program numbers = 32 - 0 = ____ (32)

L8. The code now at PC=8192 (MODE=1, allowed by L3) needs a register to work,
 but all 32 hold program numbers. Writing any one loses a program number.
 Add one more cell SCRATCH. Add instruction SWAP: exchanges a named
 register with SCRATCH in one step, no third cell, no loss.

L9. Before the program ran DOOR, boot code (a given) put a save-area address in
 SCRATCH. Pick save area at address 12288 (CH01: hex "3000" = 3*4096 = 12288).
 Also one program register, name it A, holds the number 3.

 SCRATCH = 12288
 A = 3

 run SWAP A, SCRATCH:
 A = 12288
 SCRATCH = 3

after SWAP, A = ____ (12288)
after SWAP, the 3 sits in ____ (SCRATCH)

L10. A = 12288 is now a memory address we own. Store each register there.
 A register is 8 bytes , so consecutive registers sit 8 addresses
 apart (addresses count by 1 per byte).
 register index k = 0,1,2,...,31. address of register k = 12288 + k*8.

k=0 address = 12288 + 0*8 = ____ (12288)
k=1 address = 12288 + 1*8 = ____ (12296)
k=7 address = 12288 + 7*8 = 12288+56 = ____ (12344)

L11. Map register names to k. List: R0=k0, R1=k1,..., R31=k31 (name = index).
 So register R7 has k=7, address 12344.

R9 has k=9, address = 12288 + 9*8 = 12288+72 = ____ (12360)

L12. Last register stored is the one in SCRATCH (holds 3). Read SCRATCH into
 a free register, store it. Now all 32 sit from k=0 (12288) to k=31.
k=31 address = 12288 + 31*8 = 12288 + 248 = ____ (12536)

L13. The program chose a service by leaving its number in register R7 (k=7)
 before DOOR. R7 was saved at 12344. Say it left the number 5.
 memory[12344] = 5

read service number: memory[12344] = ____ (5)

L14. A table SVC: an array of addresses, one per service number. Put SVC base at
 address 20000 (a given). Each entry 8 bytes (an address is 8 bytes).
 entry for service n sits at 20000 + n*8.

service 5 entry address = 20000 + 5*8 = 20000+40 = ____ (20040)

L15. Read that entry to get the handler's code address. Say memory[20040] = 30000
 (a given stored at boot). 30000 >= 8192 so MODE=1 may run it (still
 MODE=1 from L6, we did not lower it).
 jump 30000.

handler code starts at address ____ (30000)
30000 in the high range (>=8192)? ____ (yes)

L16. Handler runs, makes a result number 512. The program will read its answer
 from one agreed register R0 (k=0), saved at 12288 (k=0). Overwrite it.
 memory[12288] = 512

answer slot address = 12288 + 0*8 = ____ (12288)
before: memory[12288] held R0 input. after: holds ____ (512)

L17. Going back. Instruction UNDOOR mirrors DOOR. Three changes:
 change 1: reload all 32 registers from memory[12288 + k*8].
 so R0 = memory[12288] = 512.
 change 2: MODE = 0
 change 3: PC = EPC = 4096 (saved it)

 after UNDOOR: MODE=0, PC=4096, R0=512.

after UNDOOR, PC = ____ (4096, from EPC)
after UNDOOR, R0 = ____ (512)

L18. One-cell trap. R0 carried input going in, output coming out. Same cell
 (k=0, address 12288). The input was overwritten at L16.
 Program set R0=3 before DOOR (used 3 as an example input). After UNDOOR
 R0 = 512.

program set R0=3, after the round trip R0 = ____ (512, overwritten L16)

================================================================================
GRILL
register k=9 address = 12288 + 9*8 = ? (line L11)
DOOR writes how many of the 32 registers to memory? (line L7)
service 7 entry address = 20000 + 7*8 = ? (line L14)
SWAP A,SCRATCH with SCRATCH=12288, A=3. A after = ? (line L9)
service number left in R7 (k=7). read it from address = ? (line L10/L13)
after UNDOOR, PC comes from which register, value = ? (line L17)
R0=3 in, handler returns 512. R0 out = ? (line L18)

ANSWERS.
12288 + 72 = 12360
0
20000 + 56 = 20056
12288
12288 + 7*8 = 12344
EPC; 4096
512
================================================================================
NAMES.
 MODE bit = privilege level (user vs supervisor)
 the low/high cut = user pages vs kernel pages
 DOOR = ecall instruction
 UNDOOR = sret instruction
 TVEC = stvec register
 EPC = sepc register
 SCRATCH = sscratch register
 SWAP = csrrw rd, sscratch, rd
 save area @12288 = trapframe
 SVC table @20000 = syscalls[] dispatch array
 R7 (service num) = a7
 R0 (arg/return) = a0
================================================================================
