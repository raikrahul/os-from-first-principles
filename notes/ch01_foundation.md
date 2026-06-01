CH01 FOUNDATION. LINE 1 = NO DEPENDENCY. LINE N USES ONLY LINES 1..N-1.

L1. A bit is a cell. It holds 0 or 1. Nothing else.

 [0] or [1]

A bit can hold the number 2? ____ (no. only 0 or 1)

L2. Two bits side by side. Each is L1 (0 or 1). Count the combinations:
 first bit 2 choices, second bit 2 choices. 2 times 2 = 4.

 [0][0] [0][1] [1][0] [1][1]

2 bits make how many combinations? 2*2 = ____ (4)

L3. Read 2 bits as a number. Left bit worth 2, right bit worth 1. Add them.
 [0][0] = 0+0 = 0
 [0][1] = 0+1 = 1
 [1][0] = 2+0 = 2
 [1][1] = 2+1 = 3

[1][0] as a number = 2+0 = ____ (2)

L4. Three bits. Worth 4, 2, 1 left to right (each double the right neighbour).
 [1][0][1] = 4+0+1 = 5

[1][1][1] = 4+2+1 = ____ (7)
3 bits, combinations = 2*2*2 = ____ (8). numbers 0..7.

L5. Eight bits in a row = one byte (this is the name we give 8 bits).
 worth, left to right: 128 64 32 16 8 4 2 1 (each double the right one).

smallest byte = all 0 = ____ (0)
largest byte = all 1 = 128+64+32+16+8+4+2+1 = ____ (255)
So one byte holds 0..255. combinations = 256.

byte [0000 0001] = ____ (1)
byte [1000 0000] = ____ (128)
byte [1111 1111] = ____ (255)

L6. Exponent is repeated doubling, short form. 2^0=1. 2^1=2. 2^n = 2^(n-1)*2.
 2^1 = 1*2 = 2
 2^2 = 2*2 = 4
 2^3 = 4*2 = 8

2^4 = 8*2 = ____ (16)
2^8 = 2*2*2*2*2*2*2*2 = ____ (256) (matches L5 byte count)

L7. base-16 (hex). One hex digit packs 4 bits (4 bits = 2^4 = 16 values,
 from L6 2^4=16). Digits: 0..9 then a=10 b=11 c=12 d=13 e=14 f=15.

 4 bits [1010] = 8+0+2+0 = 10 = hex a
 4 bits [1111] = 15 = hex f

4 bits [1100] = 8+4+0+0 = ____ = hex ____ (12, c)

L8. Two hex digits = 8 bits = 1 byte. Left digit worth 16, right worth 1.
 hex "ff" = 15*16 + 15*1 = 240 + 15 = 255 (matches L5 largest byte)
 hex "10" = 1*16 + 0*1 = 16

hex "1f" = 1*16 + 15 = 16+15 = ____ (31)
hex "20" = 2*16 + 0 = ____ (32)

L9. Hex digit at position p (right=0) is worth 16^p (exponent, base 16).
 16^0 = 1
 16^1 = 16
 16^2 = 16*16 = 256
 16^3 = 256*16 = 4096

hex "1000" = 1*16^3 + 0 + 0 + 0 = 1*4096 = ____ (4096)
hex "2000" = 2*4096 = ____ (8192)

L10. Memory is a row of byte-cells. Each cell has an address: a number
 0,1,2,3,... naming its position. The cell holds a byte (0..255).

 address: 0 1 2 3 4
 byte: [ 12][ 00][ ff][ 41][ 00]

address 2 holds byte ____ (255, since ff = 255 from L8)
address 3 holds byte ____ (65, since hex 41 = 4*16+1 = 64+1 = 65)

L11. A register is a cell inside the chip, named by a label not an address.
 It holds 8 bytes side by side = 64 bits (8*8 = 64). Largest value =
 2^64 - 1 (2^64 doublings, minus 1 like the byte was 2^8-1 = 255).

bits in 8 bytes = 8*8 = ____ (64)
one byte max was 2^8-1 = 255. eight bytes max = 2^64 - 1. (a given form)

L12. Name one register PC. It holds an address (a number naming a memory cell). Put hex 1000 in it.

 PC = hex 1000 = 4096 (from L9)

PC holds the number ____ (4096)

L13. The chip step: read the instruction stored at address PC, do it, then set
 PC = PC + 4 (an instruction occupies 4 byte-cells; this 4 is a given of this
 chip). Next instruction sits 4 cells later (addresses).

 PC=4096 -> do instr at 4096 -> PC = 4096+4 = 4100
 PC=4100 -> do instr at 4100 -> PC = 4100+4 = 4104

after the instruction at 4104, PC = 4104+4 = ____ (4108)

L14. A jump instruction sets PC to a chosen number instead of +4.
 PC=4108 -> jump 8192 -> PC = 8192 (not 4112)

with no jump, the instruction after 8192 leaves PC = 8192+4 = ____ (8196)

================================================================================
GRILL
byte [0001 0000] = which number? (worth 16 bit set)
hex "3f" = 3*16 + 15 = ?
2^10 = 2^8 * 4 = 256*4 = ?
hex "1000" = ? decimal.
PC=8192, run one normal (non-jump) instruction. PC after = ?
memory address 4 holds hex "0a". as decimal that byte = ?

ANSWERS.
16
48+15 = 63
1024
4096
8196
10
================================================================================
EVERY LATER CHAPTER MAY USE ONLY: bit, byte (0..255), hex, exponent, memory
cell + address, register (8 bytes), PC, PC+4 step, jump. NOTHING ELSE UNTIL
THAT CHAPTER DERIVES IT FROM THESE.
================================================================================
