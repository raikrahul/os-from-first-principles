CH07 NETWORK CARD DRIVER. USES CH01 (bit, byte, hex, memory+address, register).
EACH LINE USES ONLY EARLIER LINES.

L1. The chip (CH01: PC + registers) runs your code and reads/writes memory.
 A second piece of hardware, the CARD, also reads/writes the same memory by
 itself, and puts bytes on a wire. Two separate hardware, same memory.

L2. Channel 1: shared memory. You write cells, the card reads them.
 Channel 2: a few cells inside the card, reached by writing fixed addresses.
 Writing such an address pokes the card, touches no normal memory.

tx_ring lives in normal memory or inside the card? ____ (normal memory)
a card register (channel 2) is normal memory? ____ (no, inside the card)

L3. A note (descriptor) is 16 byte-cells:
 bytes 0..7 : addr (an address, 8 bytes)
 bytes 8..9 : len (a count)
 byte 11 : cmd (flags you set)
 byte 12 : status(the card sets)

L4. The notes form a fixed row of 16 (addresses). Name it tx_ring.
 tx_ring[0], tx_ring[1],..., tx_ring[15]. After 15 wrap to 0.
 index i wraps: next index = (i+1) with remainder by 16.

i=15, next = (15+1) mod 16 = 16 mod 16 = ____ (0)
i=3, next = (3+1) mod 16 = ____ (4)

L5. A box is a chunk of memory holding the bytes to send plus a small
 front part. Two addresses on one box:
 P = box start (front) -> used to give the box back later
 D = data start (a bit past P) -> the bytes the card reads
 Pick P=0x8002_0000, front 0x40 bytes, so D = P + 0x40 = 0x8002_0040.

0x40 = 4*16 = ____ (64)
D = 0x8002_0000 + 64 = ____ (0x8002_0040)

L6. tx_ring[i] is for the card; it stores D in addr. A second row,
 tx_mbufs[i], is yours only; it stores P. same index i ties them.
 tx_ring[3].addr = 0x8002_0040 (D, for the card)
 tx_mbufs[3] = 0x8002_0000 (P, for you)

card reads which of the two? ____ (tx_ring[3].addr = D)
to give the box back you need ____ (tx_mbufs[3] = P)

L7. status byte has a DD flag = bit 0 (a bit; L5 of CH01 worth 1).
 DD value = 1. card sets DD=1 after it finishes sending that note's bytes.
 test ONE bit: status AND 1 (keep only bit 0).
 status=0x03 = bits [..0011]. 0x03 AND 1 = 1 -> DD set -> done.
 status=0x00. 0x00 AND 1 = 0 -> DD clear -> not done.

status=0x03. (0x03 AND 1) = ____ -> done? ____ (1, yes)
test status==1 on status=0x03: 0x03==1 ? ____ (no -> wrong test)

L8. TRANSMIT, draw state, i from a card register TDT (channel 2).
 TDT=3 -> i=3.
 step1 i = TDT = 3
 step2 if (tx_ring[3].status AND 1) == 0: full, return -1
 (DD clear means card still sending slot 3's old bytes)

tx_ring[3].status=0x00. (0x00 AND 1)==0 ? ____ (yes -> full, return -1)

L9. step3 if tx_mbufs[3] != 0: give old box back (the card finished it, passed
 L8). give-back uses P. tx_mbufs[3] held an old P from a past send.
 step4 tx_ring[3].addr = D = 0x8002_0040 (new box data)
 step5 tx_ring[3].len = 74 (bytes to send)
 step6 tx_ring[3].cmd = flags (EOP=last note bit, RS=set-DD-when-done bit)
 step7 tx_mbufs[3] = P = 0x8002_0000 (remember new box)
 step8 TDT = (3+1) mod 16 = 4 (; poke card = doorbell)

step8 writes 4 to TDT. memory or card register? ____ (card register)
step7 stores which address, P or D? ____ (P = 0x8002_0000)

L10. step8 is last on purpose. steps 4..7 wrote normal memory (channel 1);
 the card is not watching memory. step8 writes the card register (channel 2);
 that is what makes the card look. doorbell after the note is filled.

if you do step8 before step4, the card reads a note that is ____
 (half-filled / garbage)

L11. RECEIVE flips it. the card fills boxes with arriving bytes; you take them.
 rx_ring (card writes len+status+data), rx_mbufs (your P's). RDT register
 (channel 2) holds the last slot you handed back. card fills the NEXT one.
 i = (RDT + 1) mod 16.

RDT=1, i = (1+1) mod 16 = ____ (2)

L12. step1 i = (RDT+1) mod 16
 step2 if (rx_ring[i].status AND 1) == 0: break (no packet here DD clear)
 step3 set the box len from rx_ring[i].len (card wrote how many bytes arrived)
 step4 hand box up to the next layer (net_rx)
 step5 give the slot a FRESH empty box (or there is nowhere for the next
 packet). rx_mbufs[i] = new box P; rx_ring[i].addr = new box D.
 step6 rx_ring[i].status = 0 (clear DD so the card may set it again)
 step7 RDT = i (doorbell, hand slot back)

step5 must replace the box because you ____ the old one at step4
 (handed away / gave up)
step6 clears status so the NEXT packet's DD is ____ (set fresh by card)

L13. why TRANSMIT needs a gate but RECEIVE does not.
 transmit: many cores call it, all read TDT, all write tx_ring -> two cores
 could grab the same slot. gate makes step1..step8 one unit.
 receive: runs from the card's one "packet arrived" signal, single path, no
 second writer -> no gate.

two cores read TDT=4 at once, no gate. both fill slot ____ -> one packet
 lost. (4)

================================================================================
GRILL
tx_ring index i=15. next index = (15+1) mod 16 = ?
box P=0x8002_0000, front 0x40. D = P + 0x40 = ? (hex)
status=0x03. (status AND 1) = ? done?
RDT=1. receive i = (1+1) mod 16 = ?
tx_ring[3].addr holds D or P?
tx_mbufs[3] holds D or P?
step8 writes TDT. that is channel 1 (memory) or channel 2 (card)?

ANSWERS.
0
0x8002_0040 (64 past the start)
1; done yes
2
D (0x8002_0040)
P (0x8002_0000)
channel 2 (card register)
================================================================================
NAMES.
 CARD = E1000 ethernet controller
 note (16 bytes) = struct tx_desc / rx_desc
 tx_ring/rx_ring = descriptor rings in DRAM
 tx_mbufs/rx_mbufs = struct mbuf* arrays (driver-only)
 box P / box D = mbuf start / m->head
 DD bit = E1000_TXD_STAT_DD / E1000_RXD_STAT_DD = 0x1
 EOP / RS = E1000_TXD_CMD_EOP / _CMD_RS
 TDT / RDT = E1000_TDT / E1000_RDT tail registers (MMIO)
 doorbell, last = regs[E1000_TDT] = (i+1) % TX_RING_SIZE
 give box back = mbuffree(P)
 fresh box = mbufalloc(0)
================================================================================
