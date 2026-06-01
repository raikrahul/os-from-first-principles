CH09 FILE SYSTEM (BIG FILES, NAME LINKS). USES CH01 (byte, hex, memory+place
number, 8-byte record, exponent) and CH08 (disk = row of 1024-byte blocks,
numbered). EACH LINE USES ONLY EARLIER LINES.

L1. a file record holds an array of 13 slots, each an 8-byte... no. each slot is
 a block-number, which fits in 4 bytes (CH08 blocks numbered 0,1,2,...; 4
 bytes hold 0..2^32-1, plenty). a block is 1024 bytes. numbers per
 block = 1024 / 4 = 256.

1024 / 4 = ____ (256, block-numbers that fit in one block)

L2. slots 0..10 are direct: slot k holds the block-number of data block k.
 that is 11 direct blocks = 11 * 1024 bytes of file.

11 direct blocks * 1024 = ____ (11264 bytes via direct slots)

L3. slot 11 is single-indirect: it holds the block-number of one block that
 holds 256 data block-numbers. so 256 more data blocks.

via slot 11: 256 data blocks * 1024 = ____ (262144 bytes)

L4. slot 12 is double-indirect: it holds the block-number of one block that holds
 256 block-numbers, EACH of which holds 256 data block-numbers.
 data blocks via slot 12 = 256 * 256 (twice).

256 * 256 = ____ (65536 data blocks via slot 12)

L5. total data blocks = 11 + 256 + 65536 = ____ (65803)
 total bytes = 65803 * 1024 = ____ (67382272, about 64 mega)

L6. find data block number bn of the file (bmap). pick the path by range:
 bn < 11 : direct, answer = slot[bn]
 11 <= bn < 11+256 : single. inner index = bn - 11. read slot[11]'s block,
 take number at inner index.
 else : double. d = bn - 11 - 256. first index = d / 256,
 second index = d mod 256.

bn = 5 (< 11): direct. answer = slot[____] (5)
bn = 300: 11 <= 300 < 267? no (11+256=267, 300>=267) -> double.
 d = 300 - 11 - 256 = ____ (33)
 first index = 33 / 256 = 0 ; second index = 33 mod 256 = ____ (33)

L7. build on the fly. if slot[12] = 0 (no double block yet zero=none),
 get a free block , put its number in slot[12]. same for the inner
 block if its slot is 0. only then read/write the data block-number.

slot[12]=0 on first big write. you must first ____ (allocate a block)

L8. free a file (itrunc). free the data blocks AND the index blocks. trap: the
 double path has TWO layers of index blocks (slot[12]'s block, and each of its
 256 inner blocks). free the inner blocks AND the outer block AND the data, or
 one index block per 256 data blocks stays marked used = a slow leak.

you free data + outer block but skip the 256 inner index blocks. result:
 ____ (slow disk leak, one block per 256 data)

L9. a name link (symlink) is a file whose data bytes hold a path string. opening
 it reads the string and re-opens that path. trap: link A points to B, B points
 to A -> reading follows forever. cap the follow count at 10; on the 11th,
 fail.

A -> B -> A, no cap. the open follows ____ (forever / never ends)
follow cap = 10. on follow number 11, open ____ (fails)

L10. open with "do not follow" flag: if the final name is a link and the flag is
 set, return the link file itself, do not read its path string.

final name is a link, no-follow flag set. open returns ____
 (the link file itself, not the target)

================================================================================
GRILL
block 1024 bytes, block-number 4 bytes. numbers per block = 1024/4 = ?
data blocks via the double-indirect slot = 256 * 256 = ?
total data blocks = 11 + 256 + 65536 = ?
bn = 300. double path d = 300 - 11 - 256 = ?
d = 33. first index = 33/256 = ? ; second index = 33 mod 256 = ?
name link A->B->A, follow cap 10. open result?

ANSWERS.
256
65536
65803
33
0 ; 33
fails after 10 follows
================================================================================
NAMES.
 file record + 13 slots = inode with addrs[NDIRECT+1]
 direct slots 0..10 = 11 direct block pointers
 slot 11 single-indirect= addrs[NDIRECT] indirect block (256 entries)
 slot 12 double-indirect= addrs[NDIRECT+1] doubly-indirect block
 find data block bn = bmap
 build on the fly = balloc on demand inside bmap
 free a file = itrunc (free data + indirect + double layers)
 name link = symbolic link (T_SYMLINK)
 follow cap 10 = ELOOP guard in open
 no-follow flag = O_NOFOLLOW
================================================================================
