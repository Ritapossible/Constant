# Stellar testnet proof run

Output of `node scripts/stellar/proof-testnet.mjs --record` (D-085). Every link opens the transaction on stellar.expert.

```
# Stellar testnet proof, 2026-10-23T07:46:41.310Z
operator GBNVN6YSJOEVEZVPS3OFSUNFIB6XSGDPATJDTFVSEZFWU2L5BWXKET3U
treasury GDQ4L52RFBETWI6LFPGVCPFYFNKQ7SEFRZRI55R2766UMTYQ6WPEE2P6
contract CDZOET377WDCBXUAOGDGJFYFWA7W3IJWJPMARHW4WVK2AYPHIRWASQCE (wasm 56ab1c614134bde744380b7568da25b480fed5b2e34bff51f385c8ac7fff2e20)
  https://stellar.expert/explorer/testnet/contract/CDZOET377WDCBXUAOGDGJFYFWA7W3IJWJPMARHW4WVK2AYPHIRWASQCE
user GCF6SN6RTXQHT3HYGINSXW7QXNMIRAH3VTUC3CVW22UZXFQKGCQBLGZK (never funded with XLM)
ok   the user's account doesn't exist yet
  onboarding https://stellar.expert/explorer/testnet/tx/2767e9bc5eb2d372536134de671779f1ab19b0713af10e0139d15eb0038f47aa
ok   account and USDC trustline exist, every reserve sponsored by Constant
ok   the user holds 0 XLM
ok   onboarding again is a no-op
  25 USDC to the user https://stellar.expert/explorer/testnet/tx/d1462052a6871cf1d25a8aaacd4632c9104e518cf20e529e97cdb2dc7a7e5384
ok   the user holds 25.00 Circle testnet USDC
ok   a signature by any other key is refused
ok   mandate created: up to 10.00 USDC every 30 days, 3 periods https://stellar.expert/explorer/testnet/tx/5e7247b19a3257a20c226db95ee6e569785fde59fad4e9f43ab3c4950c61bfe5
ok   on chain: owner, cap and period as signed
ok   chargeable now: 10.00
ok   charge 1: 4.00 USDC https://stellar.expert/explorer/testnet/tx/ca196524902299e6f391475394ecc1db3af819e87551f88bae52e9a94c954ae0
ok   charge 2: 6.00 USDC https://stellar.expert/explorer/testnet/tx/d3ace630fdaeabc63140bd307796e114f24bcd42164cc755425c4283f4e81261
ok   the treasury received 10.0000000 USDC
ok   the user has 15.00 left
ok   this period's cap is used
ok   the same charge id again: refused (DuplicateCharge (#8))
ok   a charge over the cap: refused (OverCap (#7))
ok   revoked https://stellar.expert/explorer/testnet/tx/b865975bcafad99ea78a7672f8e934612b0d3e7c88bc39c20a2bcf8c7419d6e1
ok   the mandate is no longer active
ok   a charge after the revoke: refused (Revoked (#5))
ok   receipts' Merkle root on the ledger https://stellar.expert/explorer/testnet/tx/583a72d4f784edc61be687058600fd542a7961235d682c07d197ab2193dce51d
ok   each receipt's proof leads to that root
ok   the user still holds 0 XLM: every fee and reserve was Constant's

ALL PASSED
```
