CH03 ADDRESS TRANSLATION. USES CH01 (bit, byte, hex, exponent, memory+place
number, named cell, PC). EACH LINE USES ONLY EARLIER LINES.

L1. A user-number is 39 storage units wide (a bit; we pick 39). Split it
 into 4 pieces, low piece first:
 piece W = low 12 units (position inside a 4096-chunk; 2^12 = 4096)
 piece C = next 9 units
 piece B = next 9 units
 piece A = top 9 units

2^12 = 4096. so 12 low units name 1 place inside a 4096-chunk. ok?
2^9 = 512 (2^9 = 2^8*2 = 256*2). so each 9-unit piece is 0..511.

L2. A table-chunk is 4096 bytes holding 512 slots, each 8 bytes
 (a place-number is 8 bytes). 512*8 = 4096. each slot holds the
 place-number of the NEXT chunk plus a few flag units in its low part.

512 slots * 8 bytes = ____ (4096, fills the chunk exactly)

L3. A named cell holds the place-number of the FIRST table-chunk.
 Call it ROOT. Set ROOT = 0x80000 (hex).

 ROOT = 0x80000

L4. Convert a user-number U. Three descents then one read.
 descent 1: slot index = piece A (0..511). go to ROOT chunk, slot A.
 that slot holds the place-number of the next chunk. call it chunkB.
 descent 2: in chunkB, slot index = piece B. holds chunkC.
 descent 3: in chunkC, slot index = piece C. holds the FINAL physical chunk, F.
 final read: physical place = F + piece W (the within-chunk position).

L5. TRACE with numbers. U = 0x3F40 (0x3F40 = 3*4096 + 15*256 + 4*16 + 0
 = 12288 + 3840 + 64 = 16192). Pull the 4 pieces (each piece is a slice of the
 39 units). For this small U, A=0, B=0, C=0, W=0x3F40 low 12 units.

0x3F40 in low 12 units: 12 units hold 0..4095. 0x3F40 = 16192 > 4095, so
 W = 16192 mod 4096 = 16192 - 3*4096 = 16192 - 12288 = ____ (3904)
 and the 3 above 4096 (16192 / 4096 = 3) go into piece C = 3, B=0, A=0.

piece C = ____ (3)
piece W = ____ (3904)

L6. descent 1: ROOT=0x80000 , slot A=0. read 8 bytes at 0x80000 + 0*8 =
 0x80000. say it holds 0x81000 (a given table-chunk). chunkB = 0x81000.
slot A address = 0x80000 + 0*8 = ____ (0x80000)

L7. descent 2: chunkB=0x81000, slot B=0. address = 0x81000 + 0*8 = 0x81000.
 say it holds 0x82000. chunkC = 0x82000.
slot B address = 0x81000 + 0*8 = ____ (0x81000)

L8. descent 3: chunkC=0x82000, slot C=3. address = 0x82000 + 3*8 = 0x82000+24 =
 0x82018. say it holds 0x90000. final chunk F = 0x90000.
slot C address = 0x82000 + 3*8 = 0x82000 + 24 = ____ (0x82018)

L9. final read: physical place = F + W = 0x90000 + 3904.
 0x90000 = 9*16^4 = 9*65536 = 589824. + 3904 = ____ (593728)

user-number 0x3F40 lands at physical place ____ (593728)

L10. each slot's low units are flags. one flag = VALID (bit 0).
 VALID=1 means the slot points at a real next chunk. VALID=0 means no chunk
 there; a descent that hits VALID=0 fails (no physical place for that U).

descent 2 reads a slot with VALID=0. conversion ____ (fails)

L11. why 3 descents not 1 big table. 1 big table for a 39-unit user-number would
 need 2^(39-12) = 2^27 slots = 134217728 slots * 8 bytes = huge,
 per program. the tree only builds chunks for user-numbers actually used: an
 unused piece-A slot has VALID=0 and needs no chunkB/C/F at all.

2^27 = 2^20 * 2^7 = 1048576 * 128 = ____ (134217728)

L12. a small fast memory holds recent (user-number -> physical place) results so
 the 3 descents are skipped on a repeat. miss = do L4 again, then store it.

================================================================================
GRILL
2^9 = ? (slots per table-chunk piece)
512 slots * 8 bytes = ? (table-chunk size)
slot index C=3 in chunk 0x82000, slot 8 bytes. slot address = ?
final chunk F=0x90000, within-chunk W=3904. physical place = ?
descent hits a slot with VALID bit (bit 0) = 0. result?
one big flat table for 39-unit user-number, 12 low units inside-chunk:
 slot count = 2^(39-12) = 2^27 = ?

ANSWERS.
512
4096
0x82000 + 24 = 0x82018
0x90000 + 3904 = 593728
conversion fails (no physical place)
134217728
================================================================================
NAMES.
 user-number = virtual address
 physical place = physical address
 table-chunk = page table page (512 PTEs)
 slot = page table entry (PTE)
 ROOT cell = satp register
 3 descents = 3-level page walk (Sv39)
 VALID flag bit 0 = PTE_V
 small fast memory = TLB
 the conversion = MMU address translation
================================================================================
