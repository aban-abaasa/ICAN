# icaneracoin on the blockchain: deploy guide

icaneracoin now exists in **two on-chain forms**. Everything ships **OFF** and on **test networks only**. Nothing in this guide is a reason to put real money in: read "Launch gates" first.

| | **ICEC-S** (stable) | **ICEC-C** (community) |
|---|---|---|
| What it is | A US-dollar token, backed 1:1 by a dollar stablecoin held in a public vault | A public receipt for icaneracoin that lives in the IcanEra ledger |
| Price | Always 1 US dollar. In shillings it is worth *units × USD/UGX* | Whatever the platform's price engine says, exactly like the ledger coin, moving with the market |
| Where it lives | Only on the chain, in the user's own wallet | On the chain **and** the ledger: moving it on-chain locks the ledger ICEC; burning it brings the ledger ICEC back |
| Can it be sent to someone else | Yes (it is a normal token) | **No.** It can only be minted to a linked wallet and burned back (otherwise anyone could buy it cheap on an exchange and burn it for credit at the engine price, draining the treasury) |
| Who can move it | Only its holder. IcanEra cannot. | Only its holder can burn it. The bridge operator can mint only against a ledger withdrawal. |
| Oracle on the money path | **None.** Deposit and redeem are 1:1 in the contract | None. The ledger price is not read on-chain at all |
| Protects against inflation? | **No promise.** It keeps its dollar value: rises in shillings if the shilling weakens, falls if it strengthens | **No.** Putting a coin on a chain does not change what it is worth |

Self-custody throughout: users sign every on-chain action in their own wallet. The app and the relayer never see a user's key, and IcanEra cannot recover a lost one.

## What is built

```
blockchain/                      Hardhat project: contracts, 57 tests, deploy script, end-to-end test
  contracts/ReserveVault.sol       holds the stablecoin; deposit / redeem 1:1; invariant reserve >= supply after every move
  contracts/IcecStable.sol         ICEC-S, mintable and burnable only by the vault
  contracts/IcecCommunity.sol      ICEC-C, non-transferable; mint by the operator once per withdrawal id, daily cap, pausable
  scripts/deploy.js                testnet-only, env-driven, refuses main networks, never sees the relayer's key
  e2e/chain-e2e.mjs                real contracts + real database + real relayer + real panels in a browser
supabase/migrations/20261020100000_chain_core.sql        schema icanera_chain: addresses, withdrawals, burns, the locked ledger, guards
supabase/migrations/20261020110000_chain_bridge.sql      the bridge functions (users, relayer, administrators)
supabase/migrations/20261020120000_chain_fx_oracle.sql   informational USD -> local exchange rate (display only)
supabase/rollback/20261020_rollback_chain*.sql           stop-and-keep-the-books, and the destructive drop
supabase/tests/chain/run.sh                              282 database checks + 7 concurrency races + rollback
frontend/api/_lib/chainRoutes.js                         /api/chain-sync, /api/chain-link, /api/fx-oracle (served by an existing function: see below)
frontend/api/_lib/chainRelayer.js                        the relayer's logic (32 unit tests)
frontend/src/components/OnChainPanel.jsx  StableUnitPanel.jsx  IcecChainPanel.jsx   wallet -> Trade -> On-chain
frontend/src/components/ICANChainDevTab.jsx              dev panel -> On-chain
```

## Deploy, step by step

### 1. The contracts (you run this, with your own key)

```bash
cd blockchain && npm install
CHAIN_RPC_URL=https://...  DEPLOYER_PRIVATE_KEY=0x...  \
RESERVE_TOKEN=0x<the test stablecoin on that network>  \
OWNER_ADDRESS=0x<multisig>  GUARDIAN_ADDRESS=0x<a second key>  OPERATOR_ADDRESS=0x<the relayer's ADDRESS>  \
DAILY_MINT_CAP_ICEC=1000  npx hardhat run scripts/deploy.js --network sepolia
```

It prints the addresses, saves them to `blockchain/deployments/<chain>.json` (addresses only, no keys) and prints the exact SQL and environment to use next. It refuses well-known main networks with no override. Use the issuer's **real address for the test stablecoin on that network**; `DEPLOY_MOCK_RESERVE=1` deploys a stablecoin *anyone can mint* and is for a local chain (`npx hardhat node`, then `--network localhost`).

Roles: **owner** (a multisig; sets the operator, the guardian and the daily cap; resumes minting), **guardian** (a separate key; can only pause minting and deposits), **operator** (the relayer's hot key; can only mint against a withdrawal id, up to the daily cap).

### 2. The database (Supabase SQL editor)

**Easiest:** paste the whole of `CHAIN_TOKENS_PASTE_INTO_SUPABASE.sql` (repo root) into the SQL editor and press Run once. It is the four files below, in order, generated from them (`node scripts/build-onchain-paste.mjs`). Or run them one at a time:

1. `supabase/migrations/20261020100000_chain_core.sql`
2. `supabase/migrations/20261020110000_chain_bridge.sql`
3. `supabase/migrations/20261020120000_chain_fx_oracle.sql`
4. `supabase/migrations/20261021100000_chain_auto_contracts.sql` (the chain id, the ICEC-S token and the reserve coin detect themselves; forgiving address entry)

Each is safe to run twice and keeps every setting an administrator changed. Then tell the database the **two** things the chain cannot say about itself (the deploy script prints this; the dev panel's *On-chain tokens → Contracts* box does the same):

```sql
SELECT public.ican_chain_dev_set_contracts('<dev token>', '{"icec_community_address": "0x…", "stable_vault_address": "0x…"}'::jsonb);
```

That is all. **Everything else is detected and kept in sync with the chain:**

| Field | Where it comes from |
|---|---|
| chain id (and, for the common test networks, the name and explorer link) | the network the relayer's RPC endpoint is on, adopted once on its first run. After that it is a guard: a different endpoint halts the bridge |
| ICEC-S token, reserve stablecoin, its symbol | read from the vault (`token()`, `reserve()`, `symbol()`) by the relayer on every run and written back whenever they differ (and re-confirmed at least hourly, which the dev panel shows as "last checked"). A new vault clears the old ones at once |
| what the screens use | the screens read the token and reserve straight from the vault, so they work before the relayer has run and ignore any stale copy |

The address boxes are forgiving: capitals, quotes, spaces, no `0x`, or a whole block-explorer link all work. A wrong `stable_token_address`, `reserve_token_address` or `chain_id` typed in by an older script is accepted and ignored in favour of what the chain says. If something is refused, the message names the field and what it expected. The relayer also checks the ICEC-C address really is ICEC-C (symbol `ICEC-C`, 8 decimals) and halts the bridge if it is some other contract.

To turn the bridge ON you need the chain to have been detected, so save the two addresses, wait for the relayer's next run (a minute or two), then switch it on. Set `chain_name`, `explorer_url`, `confirmations` with `ican_chain_dev_set_settings` if you want different values than the defaults.

The chain and the ICEC-C contract **cannot be changed** once withdrawals exist; moving the bridge to another contract is a migration, not a setting.

### 3. The relayer (environment on the host that serves `frontend/api`)

| Variable | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | already used by the other endpoints; the relayer calls only the `ican_chain_operator_*` functions, which are granted to the service role alone |
| `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`) | wallet linking asks Supabase who the caller is |
| `CHAIN_RPC_URL` | the node endpoint. The chain id is read from it |
| `CHAIN_ID` | **optional**. If set, it must equal the endpoint's chain; a mismatch halts the bridge (a cheap guard against pointing at the wrong network) |
| `BRIDGE_OPERATOR_KEY` | **the one hot key**. Secret store only. Fund it with a few days of gas, nothing more |
| `CHAIN_CRON_SECRET` (or `CRON_SECRET`) | at least 16 characters; the endpoints refuse everything without it |
| `CHAIN_START_BLOCK` | the ICEC-C deployment block (the deploy script prints it) so the first scan does not start at genesis |
| `FX_PROVIDER_URL`, `FX_PAIRS` | optional; default `open.er-api.com` and `USD/UGX,USD/KES,USD/TZS,USD/RWF` |

### 4. Schedule it

**Why these three endpoints are not their own files:** every file under `frontend/api/` is a separate Vercel serverless function, and the Hobby plan allows **12 per deployment**. The project was already at 12, so three more files made the whole deploy fail. The three endpoints live in `api/_lib/chainRoutes.js`, `api/investment-expiry-sweep.js` hands them requests carrying `?job=chain-sync | chain-link | fx-oracle`, and `vercel.json` rewrites `/api/chain-sync`, `/api/chain-link` and `/api/fx-oracle` onto it, so the public URLs are exactly as below and cost no function slot. `frontend/tests/apiFunctionCount.test.js` fails if `api/` ever goes over 12 again.

`/api/chain-sync` and `/api/fx-oracle` should run **every minute**. They accept `Authorization: Bearer <secret>` (what Vercel Cron sends when `CRON_SECRET` is set) or `x-automation-secret: <secret>`. Vercel's per-minute cron needs a paid plan, and a too-frequent `crons` entry **fails the deployment on the free plan**, so this repository does not add one to `vercel.json`: add `{ "crons": [{ "path": "/api/chain-sync", "schedule": "* * * * *" }, { "path": "/api/fx-oracle", "schedule": "* * * * *" }] }` yourself on a plan that allows it, or call the URLs from any scheduler (GitHub Actions, Supabase `pg_cron` + `pg_net`, a small VM). A run takes seconds; two overlapping runs are safe (a database lease makes the second one stand down).

The endpoints deliberately do **not** trust the `x-vercel-cron` header (see "Findings").

### 5. Turn it on (dev panel → On-chain → *Turn ON*) only after the launch gates below are true.

## How the bridge stays honest

- A withdrawal **locks** ledger ICEC (insert-only `locked_entries`; one lock and at most one release per withdrawal, enforced by unique indexes) and queues a mint of the same amount. The user can cancel and be refunded **only while nothing has been signed for it**; once the relayer has signed a transaction, the mint may exist on-chain, so the ledger never refunds it. The relayer records the signed transaction's hash **before** broadcasting, so a cancel and a broadcast can never both win (tested with 24 sessions racing: 0 withdrawals both refunded and sent).
- The contract mints each withdrawal id at most once, and no more than the daily cap per day, whatever the relayer asks.
- A **burn** is credited only to the account that proved it owns the burning address, only up to what was minted to **that address** and not yet paid back, and only once per on-chain event (`chain, tx, log index`). Anything else is parked as *unclaimed*, never credited.
- The relayer reads events only at confirmation depth, in chain order, and reports them as they happened. The database refuses what does not match: a mint it did not ask for, a mint with a different amount or recipient, a second mint for one withdrawal, a mint after a refund, an event from another chain. Each is recorded as an **anomaly** and **halts new withdrawals**. Every run also compares the contract's total supply with the ledger at the block it just read; a difference halts the bridge.
- A halt stops **new** withdrawals; burn-backs are still credited (a burn can only ever return value to the account that bridged it out).
- Bridge moves are **not** written to `ican_coin_transactions`: the price engine counts those rows as usage, and booking bridge moves there would let someone move the coin's price by bridging back and forth.
- The exchange rate for ICEC-S is **display only**: no mint, redeem, withdrawal or trade reads it. It is a time-weighted average of recent observations with a jump guard (a move over 5% is held back until three observations in a row agree) and a staleness flag.

## Who can do what (threat model)

| Holder | Can | Cannot |
|---|---|---|
| A user's wallet key | Move their own ICEC-S; burn their own ICEC-C | Anyone else's tokens |
| Relayer / operator hot key | Mint ICEC-C against **existing** withdrawal ids, up to the contract's daily cap | Mint without a withdrawal that the database recognises (the database halts the bridge on the first unknown mint); touch ICEC-S; move ledger ICEC |
| Guardian | Pause ICEC-C minting; pause ICEC-S deposits | Mint, burn, move or seize anything; pause redemption |
| Owner (multisig) | Set operator, guardian, daily cap; resume minting | Move or seize anyone's tokens; change the contracts (no proxy, no upgrade) |
| `SUPABASE_SERVICE_ROLE_KEY` | Call the relayer functions | (it can already do far more in this project: protect it as before) |
| Dev token | Change settings, resolve anomalies, requeue | Edit a ledger row (the ledgers are insert-only; money tables reject edits even from the owner) |

**If the operator key leaks:** the damage is bounded by the daily cap, and tokens minted to anyone but a linked address can never become ledger credit. Pause minting (guardian), rotate with `setOperator` (owner), and expect the bridge to have halted itself: the relayer reports any mint it never asked for. An unknown mint cannot be undone, so the supply check will keep failing against that contract: the safe path is a new contract (see below). Cap exposure by keeping the daily cap small and the key's gas balance small. A KMS-backed signer is the recommended upgrade.

**If the stablecoin behind ICEC-S loses its peg or freezes the vault's address:** ICEC-S inherits that. Pause deposits (guardian); redemption stays open and pays what the vault holds. The vault cannot fix an issuer problem.

**If a contract bug is ever found:** there is no upgrade path by design. Pause, deploy a new contract, point the database at it (a migration, not a setting), and let holders redeem or burn back from the old one.

## Launch gates: nothing below is code, and the bridge must stay OFF until all of it is true

1. **An independent smart-contract audit** of `ReserveVault`, `IcecStable` and `IcecCommunity`. The test suites here (reentrancy, fee-on-transfer, donation, permit, randomized invariant runs) are not a substitute.
2. **Legal advice** on issuing a dollar-backed token and on the ICEC bridge in Uganda (e-money, virtual-asset and consumer rules), and on the user-facing wording.
3. **A UGX on/off-ramp partner.** Self-custody means a user cannot pay with mobile money and receive ICEC-S: they must already hold stablecoin in their own wallet. The people this is for mostly do not, so this is the biggest practical gap; it is a business integration outside this build.
4. **Multisig and key policy:** the owner is a multisig; the guardian is a separate key; the operator key lives in a secret store (ideally a KMS) with a small daily cap and a small gas balance; a written rotation procedure.
5. **The stablecoin's real address on each chain, verified against the issuer's own documentation.**
6. **An incident runbook** (pause, rotate, migrate, communicate) rehearsed on a testnet.
7. **Mobile wallets:** a phone's regular browser has no wallet. Today it works in a wallet app's built-in browser or a desktop browser with an extension; WalletConnect is a follow-up.

## Operating it

Dev panel → **On-chain**: the switch, the contracts, the limits, the queue by state, unclaimed burns, open anomalies, the last supply check, the exchange-rate feed's health, and **Reconcile the books** (recomputes the locked ledger from the immutable entries and checks one lock and at most one release per withdrawal, no address paid back more than was minted to it, no open anomaly, and the last supply check).

- **An anomaly** halts the bridge and stays until a person closes it with a note saying what was found. Closing it does not turn the bridge back on.
- **A withdrawal stuck in "submitted"** (the transaction never appeared): check on-chain that `processed(ref)` is false and that no transaction for it can still be mined, then *requeue* it from the dev panel with a memo. Never refund it by hand.
- **Unclaimed burns** are burns the database would not credit (an address nobody linked, or more than was minted to that address). The ICEC stays in the locked ledger. If you decide an owner should be paid, do it as a deliberate, recorded ledger adjustment: nothing credits it automatically.
- **Reorgs:** events are believed only at `confirmations` blocks deep (default 12). Raise it on a chain with deep reorganisations.

## What was measured

- **Contracts:** 57 tests: 1:1 mint and redeem, no fee, balance-delta crediting, a fee-on-transfer token, a token that re-enters the vault, a donated surplus, permit, pause rules, the mint cap and its daily reset, idempotent mints, every transfer path reverting, ownership in two steps, and 6 randomized sequences of 250 steps each checking the vault's invariant (reserve ≥ supply) and ICEC-C's (supply = minted − burned) against a shadow model after every step.
- **Database:** `supabase/tests/chain/run.sh`: **304 checks**, plus seven races with real concurrency: 120 attempts to withdraw 30 from a 100 balance → exactly 3 succeed; one request sent 40 times → one withdrawal; one burn event reported 40 times → credited once; 20 burns racing for 6 outstanding → exactly 2 credited; a cancel and a "signed" racing for 300 withdrawals → none both refunded and sent; **100 users bridging at once with a relayer minting and users burning back (about 1,700 operations/s): every ICEC in wallets + locked is identical before and after, to the last digit**; and a coin trade and a bridge withdrawal by the same person at once never deadlock. A 400-step random run holds "wallets + locked = constant" after every step. The race run found one real deadlock (two overlapping retry passes taking user locks in opposite orders); it is fixed with a single-pass lock and the run was repeated six times clean. Both rollbacks and a clean re-install are exercised.
- **Relayer:** 32 unit tests (fake database, chain and contract): confirmation depth, chain order, record-before-broadcast, refusal to send on a bad reference, paused or over-cap, a reverted attempt requeued, a halted run still credits burn-backs, supply check, wallet-link verification, the endpoint lock.
- **Frontend:** `chainMath` has 12 tests holding the on-screen arithmetic to the contracts' integers (exact BigInt, no floating point).
- **End to end** (`cd blockchain && npm run e2e`): the real contracts on a local chain, the real database, the real relayer and the real panels in Chromium with a wallet injected, **36 checks**: deposit 250 → 250 ICEC-S one for one; redeem 50; proof of reserve live; link a wallet by signature through the real endpoint; withdraw, cancel and refund; mint; burn 5 back and be credited exactly once; ICEC conserved (485 + 15 = 500); then **a stolen-operator-key incident**: a mint nobody asked for halts the bridge, the attacker burning it gets nothing, and the ledger does not move.

## Known limits, and what is not built

- **No audit** (see the gates). **No WalletConnect.** **No permit-based one-step deposit in the screen** (the contract supports it; the screen uses approve then deposit, approving exactly the amount).
- **ICEC-S does not beat inflation and the screen does not say it does.** It protects against the shilling weakening against the dollar, and loses value in shillings when the shilling strengthens.
- **The default rate provider refreshes about once a day.** The screen shows how old the rate is and flags it when stale; use a provider with intraday rates if it should follow the market within minutes.
- The relayer is a scheduled function, not a long-running indexer: it reads in bounded batches (5,000 blocks a run) and catches up over several runs.
- The relayer's hot key is an environment variable. A KMS-backed signer is better and is not built.
- No cross-chain bridge, no gas sponsorship (a user pays the network fee in the network's own coin), no ICEC-S inside the ledger (the database never holds it).

## Findings in code that was already here (not changed by this work)

1. **`frontend/src/services/blockchainService.js`** signs transactions with a wallet private key *passed in from browser code* (`new ethers.Wallet(walletPrivateKey, provider)`). Any key that reaches the browser is exposed to every script on the page. Nothing in the new on-chain tokens uses it, and it should not be used for money.
2. **`api/investment-expiry-sweep.js` and `api/report-automation.js` treat a request carrying the header `x-vercel-cron: 1` as authorised**, even when a secret is configured. Anyone can add that header. For those two endpoints the effect is limited (the sweep is idempotent), but the same pattern on an endpoint that holds a key would be a hole, which is why the new endpoints require the shared secret instead. Moving those two to `Authorization: Bearer $CRON_SECRET` is a small change worth making.

## Rollback

`supabase/rollback/20261020_rollback_chain.sql` pauses the bridge, removes every `ican_chain_*` / `ican_bridge_*` / `ican_fx_rate` function and the scheduled prune, and **keeps every ledger**. **Pause first** (dev panel) and let holders burn back until the locked total is zero (`SELECT icanera_chain.locked_total();`) *before* removing the functions: removing them removes the way a burn becomes ledger credit. `20261020_rollback_chain_DROP_DATA.sql` deletes the schema and refuses while any ICEC is still locked. The on-chain contracts are immutable and are not touched by either.
