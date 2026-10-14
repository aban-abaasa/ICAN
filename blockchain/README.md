# icaneracoin contracts

Two on-chain forms of icaneracoin. **Testnet only from this repository; unaudited.** Read `../CHAIN_TOKENS_DEPLOY.md` first.

- `ReserveVault` + `IcecStable` (**ICEC-S**): a US-dollar token backed 1:1 by a stablecoin held in the vault; redeemable any time; no fee, no oracle, no admin mint or withdrawal. Invariant: `reserve.balanceOf(vault) >= ICEC-S.totalSupply()`.
- `IcecCommunity` (**ICEC-C**): a non-transferable receipt for ledger icaneracoin; minted by the bridge operator once per withdrawal id (daily cap, pausable), burned by its holder to bring the ledger ICEC back.

```bash
npm install
npm test                         # 57 tests (compiles with the solc npm package: no download from soliditylang.org)
npx hardhat node                 # a local chain, in another terminal
DEPLOY_MOCK_RESERVE=1 npx hardhat run scripts/deploy.js --network localhost
npm run e2e                      # the whole stack: contracts + database + relayer + the panels in a browser (see e2e/chain-e2e.mjs)
```

Deploying to a test network and the full runbook: `../CHAIN_TOKENS_DEPLOY.md`. `.env.example` lists the variables; keep real values in your shell or secret store, never in a file in this repository.
