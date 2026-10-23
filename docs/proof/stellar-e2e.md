# Stellar testnet: end to end through the API and worker

Output of `node scripts/stellar/e2e-testnet.mjs --record` (D-085).

```
# Stellar testnet, end to end through the API and worker, 2026-10-23T07:47:43.664Z
contract https://stellar.expert/explorer/testnet/contract/CAFVOKGNPLNJFTHL47R526U4WT5NPIE37OA2VHMXLQQU4C3OROL372DB
operator (worker) GAEVFCZF6N4JZUTOFRQ2ZR3QCYAEC37LT2UOUFFJ7Y2A6IVNQYIZUWP6 · sponsor (API) GC5XQOU6S2NB3C2OZGORFPV2CV42X2OAF6UR5UFIWD2YDVFJV5I2GTBD · treasury GACAWKD4NTTTXWHA6SXO2AA3SU6U7WRMR22AL2NQAX6M4S44GYPTELTD
user GAB4O5L3OUKWSTWKFHD4ZYHZ6RU3UEYA3B6EIPCRTZUMRKMKIGBPLRSW
ok   linked by signing: "ConstantUnits: link GAB4O5L3OUKWSTWKFHD4ZYHZ6RU3UEYA3B6EIPCRTZUMRKMKIGBPLRSW to my account. Code 286cb1181eb95d6468f0ba45"
ok   account opened for USDC, reserves sponsored https://stellar.expert/explorer/testnet/tx/57d1288e9baedb5a6f93addd97a8a53a44e62a69176a3daeb1b24755514230e0
ok   the user holds 0 XLM
  30 Circle testnet USDC arrive https://stellar.expert/explorer/testnet/tx/f18153d54b694d6394dbbf2a8aec71f35518cc39acd14593d3b08628e30f247d
ok   bill added: DStv Compact, ₦19,950 due 2026-10-23T13:48:03.260Z
ok   proposal: up to 19.97 USDC every 30 days, until 2027-02-15
ok   the user's one signature is stored; nothing is on chain yet
ok   mandate registered by the worker https://stellar.expert/explorer/testnet/tx/d1f034b907130c986d45e10abe4f291198ae03c2e583aaf2cd066e528e4b4abb
ok   the bill now pays from USDC on Stellar
ok   renewal due: one order
ok   charged 14.75 USDC, confirmed before the vend https://stellar.expert/explorer/testnet/tx/89ff3db7cb41bb68516688002d68384bc7934ee873396d97879a3f514c58c077
ok   the treasury holds 14.7522080 USDC
ok   credited exactly ₦19950 against that transaction
ok   the decoder was renewed once
ok   the user stops it in the app
ok   mandate revoked on chain by the worker https://stellar.expert/explorer/testnet/tx/4a290c94a0aa675c94d55481d4c8bcd1fd950614db072518402cf393ec8af34b
ok   the user still holds 0 XLM

ALL PASSED
```
