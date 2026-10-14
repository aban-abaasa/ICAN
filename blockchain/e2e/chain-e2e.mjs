// End-to-end test of the on-chain tokens, with everything real except the HTTP front of Supabase:
//
//   a local Hardhat chain            with the REAL contracts deployed (ReserveVault + ICEC-S, ICEC-C, a mock USD stablecoin)
//   a real Postgres                  with the REAL migrations (base icaneracoin stack + the three chain files)
//   the REAL relayer code            frontend/api/_lib/chainRelayer.js, signing with a real key, talking to the chain and the DB
//   the REAL wallet-link endpoint    frontend/api/_lib/chainRoutes.js (chainLinkHandler)
//   the REAL panels in Chromium      OnChainPanel (ICEC-S and ICEC-C) driven like a person would, with a wallet injected
//
// The injected wallet forwards to the Hardhat node's unlocked accounts, so every transaction and signature is genuine.
// supabaseShim.mjs is a small stand-in for Supabase's REST layer (it runs the app's RPC calls on the real database as the
// role the token carries). Nothing here touches a real network, a real key or a real project.
//
//   npm run e2e        (from /blockchain; needs Postgres, with a role that can create databases, and Chromium via Playwright)
//   PGHOST / PGUSER / ... as usual; E2E_KEEP=1 leaves the DB and logs behind.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { startShim, makeToken } from './supabaseShim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOCKCHAIN = path.resolve(HERE, '..');
const ROOT = path.resolve(BLOCKCHAIN, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'chain-e2e-'));
const DB = process.env.E2E_DB || 'ican_chain_e2e';
const HH = 'http://127.0.0.1:8545';
const SHIM = 'http://127.0.0.1:54321';
const WEB = 'http://127.0.0.1:5199';
const SERVICE_KEY = 'service-key-e2e';
const ANON_KEY = 'anon-key-e2e';
const DEV = 'dev_test_secret';
const USER_ID = '0a0a0a0a-1111-4222-8333-444444444444';

const { ethers } = await import(pathToFileURL(path.join(FRONTEND, 'node_modules/ethers/lib.esm/index.js')).href);
const { createSupabaseRpc, runSync } = await import(pathToFileURL(path.join(FRONTEND, 'api/_lib/chainRelayer.js')).href);
const { chainLinkHandler: chainLink } = await import(pathToFileURL(path.join(FRONTEND, 'api/_lib/chainRoutes.js')).href);
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');

const children = [];
const log = (...a) => console.log('•', ...a);
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ').slice(0, 120)} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
};
const psql = (sql, db = DB) => sh('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql]).trim();
const start = (name, cmd, args, opts, ready) => new Promise((resolve, reject) => {
  const out = fs.createWriteStream(path.join(OUT, `${name}.log`));
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: true });   // its own process group, so npx's children die with it
  children.push(child);
  let done = false;
  const onData = (d) => { out.write(d); if (!done && ready.test(String(d))) { done = true; resolve(child); } };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('exit', (code) => { if (!done) reject(new Error(`${name} exited early (${code}); see ${OUT}/${name}.log`)); });
  setTimeout(() => { if (!done) reject(new Error(`${name} did not start in time; see ${OUT}/${name}.log`)); }, 90_000);
});
const cleanup = async () => { for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } } } };

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? '  ✔' : '  ✘'} ${name}${ok ? '' : `  ${info}`}`); if (!ok) throw new Error(`E2E check failed: ${name} ${info}`); };

let browser;
let shim;
let page;
const consoleLines = [];
try {
  // ---------------------------------------------------------------- the database
  log('building the database (base icaneracoin stack + the chain migrations)');
  sh('psql', ['-X', '-q', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${DB}"`, '-c', `CREATE DATABASE "${DB}"`]);
  const BASE = ['supabase/tests/icaneracoin_chart/00_stub.sql', 'frontend/backend/ICAN_PRICE_ENGINE.sql', 'frontend/backend/ICAN_REAL_CANDLESTICK_ENGINE.sql',
    'supabase/migrations/20261017100000_public_icaneracoin_chart.sql', 'supabase/migrations/20261018100000_icaneracoin_burst_safe_feed.sql',
    'supabase/migrations/20261018110000_icaneracoin_atomic_trade.sql', 'supabase/migrations/20261020100000_chain_core.sql',
    'supabase/migrations/20261020110000_chain_bridge.sql', 'supabase/migrations/20261020120000_chain_fx_oracle.sql',
    'supabase/migrations/20261021100000_chain_auto_contracts.sql'];
  for (const f of BASE) sh('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', path.join(ROOT, f)]);

  // ---------------------------------------------------------------- the chain
  log('compiling and starting a local chain');
  sh('npx', ['hardhat', 'compile'], { cwd: BLOCKCHAIN, env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' } });
  await start('hardhat', 'npx', ['hardhat', 'node', '--port', '8545'], { cwd: BLOCKCHAIN, env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' } }, /Started HTTP and WebSocket JSON-RPC server/);
  const provider = new ethers.JsonRpcProvider(HH, undefined, { cacheTimeout: -1, batchMaxCount: 1 });   // no response caching: a stale nonce would break back-to-back transactions
  const MNEMONIC = 'test test test test test test test test test test test junk';   // Hardhat's public development accounts
  const acct = (i) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
  const deployer = acct(0).connect(provider);
  const relayerKey = acct(1).connect(provider);
  const guardian = acct(2);
  const userWallet = acct(3);
  const artifact = (rel) => JSON.parse(fs.readFileSync(path.join(BLOCKCHAIN, 'artifacts/contracts', rel), 'utf8'));
  const deploy = async (rel, ...args) => {
    const a = artifact(rel);
    const c = await new ethers.ContractFactory(a.abi, a.bytecode, deployer).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const usdc = await deploy('mocks/MockStablecoin.sol/MockStablecoin.json');
  const vault = await deploy('ReserveVault.sol/ReserveVault.json', await usdc.getAddress(), guardian.address, 'icaneracoin Stable', 'ICEC-S');
  const iceS = new ethers.Contract(await vault.token(), artifact('IcecStable.sol/IcecStable.json').abi, provider);
  const iceC = await deploy('IcecCommunity.sol/IcecCommunity.json', deployer.address, relayerKey.address, guardian.address, 1_000_000n * 10n ** 8n);
  const symbol = await usdc.symbol();
  await (await usdc.mint(userWallet.address, 1000n * 10n ** 6n)).wait();
  log(`contracts: ${symbol} ${await usdc.getAddress()}, vault ${await vault.getAddress()}, ICEC-C ${await iceC.getAddress()}`);

  // ---------------------------------------------------------------- configure the bridge, seed a user
  // The administrator supplies only the two things the chain cannot say about itself: the ICEC-C contract and the ICEC-S vault.
  // (Pasted the way people paste: capitals, an explorer link. A wrong "token" typed in as well must be ignored, not believed.)
  const cfgJson = JSON.stringify({
    icec_community_address: `https://explorer.local/address/${(await iceC.getAddress()).toUpperCase().replace('0X', '0x')}`,
    stable_vault_address: ` ${await vault.getAddress()} `,
    stable_token_address: '0x' + '12'.repeat(20),
  });
  const setRes = JSON.parse(psql(`SELECT public.ican_chain_dev_set_contracts('${DEV}', '${cfgJson}'::jsonb)`));
  check('saving the two addresses works as pasted, and the typed token is ignored', setRes.success === true && setRes.auto_detected.includes('stable_token_address'), JSON.stringify(setRes));
  check('the chain id is not there yet: it is the relayer\'s to detect', psql('SELECT chain_id IS NULL FROM icanera_chain.chain_settings') === 't');

  // ---------------------------------------------------------------- the relayer (the real code, a real key, the real chain and database)
  const relayerDb = createSupabaseRpc({ url: SHIM, serviceKey: SERVICE_KEY });
  const relayerCfg = { startBlock: 0, maxMintsPerRun: 10, maxBlocksPerRun: 5000, minGasWei: 10n ** 15n, leaseSeconds: 240 };   // no chainId: it is read from the endpoint
  const mine = async (n = 2) => { for (let i = 0; i < n; i += 1) await provider.send('evm_mine', []); };
  const sync = () => runSync({ db: relayerDb, provider, signer: relayerKey, cfg: relayerCfg, holder: 'e2e' });

  psql(`SELECT set_config('request.jwt.claim.role', 'service_role', true), public.ican_chain_operator_fx_observe('USD/UGX', 3700, 'e2e-feed', now())`);
  psql(`INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'e2e@test.dev'); INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('${USER_ID}', 500)`);
  const ledger = () => Number(psql(`SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = '${USER_ID}'`));
  const locked = () => Number(psql('SELECT icanera_chain.locked_total()'));
  const reconcile = () => JSON.parse(psql(`SELECT public.ican_chain_dev_reconcile('${DEV}')`));

  // ---------------------------------------------------------------- the HTTP stand-in, and the web app
  process.env.SUPABASE_URL = SHIM; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY; process.env.SUPABASE_ANON_KEY = ANON_KEY;
  shim = await startShim({ database: DB, serviceKey: SERVICE_KEY, anonKey: ANON_KEY, chainLinkHandler: chainLink });

  // ---------------------------------------------------------------- the first run: the chain, the token and the reserve fill themselves in
  const first = await sync();
  check('the first run adopted chain 31337 from the endpoint and raised no error', first.adoptedChain === 31337 && first.errors.length === 0 && !first.halted, JSON.stringify(first));
  const row = psql("SELECT chain_id || '|' || chain_name || '|' || lower(stable_token_address) || '|' || lower(reserve_token_address) || '|' || reserve_token_symbol || '|' || (contracts_checked_at IS NOT NULL)::text FROM icanera_chain.chain_settings");
  check('and the ICEC-S token, the reserve coin and its symbol were read from the vault (not from what was typed)',
    row === `31337|Local test chain|${(await iceS.getAddress()).toLowerCase()}|${(await usdc.getAddress()).toLowerCase()}|${symbol}|true`, row);
  const again = await sync();
  check('a second run adopts and writes nothing new', again.adoptedChain === undefined && again.vaultFacts === undefined && again.errors.length === 0, JSON.stringify(again));
  psql(`SELECT public.ican_chain_dev_set_settings('${DEV}', '{"bridge_enabled": true, "confirmations": 1, "chain_name": "Local Hardhat", "explorer_url": "https://explorer.local", "min_withdrawal_icec": 1, "max_withdrawal_icec": 100, "max_daily_withdrawal_icec": 300}'::jsonb)`);
  // The screens read the token and the reserve from the vault on the chain, so they must not depend on the database's copy at all:
  // blank it, and the panels below still have to work. (The relayer writes it back on its next run, checked at the end.)
  psql("UPDATE icanera_chain.chain_settings SET stable_token_address = NULL, reserve_token_address = NULL, reserve_token_symbol = 'OLD' WHERE id = TRUE");
  log('starting the web app');
  await start('vite', 'npx', ['vite', '--port', '5199', '--host', '127.0.0.1', '--open', 'false'],
    { cwd: FRONTEND, env: { ...process.env, BROWSER: 'none', VITE_SUPABASE_URL: SHIM, VITE_SUPABASE_ANON_KEY: ANON_KEY } }, /Local:/);

  // ---------------------------------------------------------------- the browser, with a wallet injected
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 720, height: 1100 }, colorScheme: 'dark' });
  let rpcId = 0;
  await context.exposeFunction('__rpc', async (method, params) => {
    const r = await fetch(HH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
    return j.result;
  });
  const session = { access_token: makeToken(USER_ID), refresh_token: 'r', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'e2e@test.dev', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  await context.addInitScript(({ account, key, value }) => {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'wallet_switchEthereumChain') return null;
        return window.__rpc(method, params || []);
      },
      on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); },
      removeListener: () => {},
    };
  }, { account: userWallet.address, key: 'sb-127-auth-token', value: JSON.stringify(session) });
  // the app calls its own serverless endpoint at /api/chain-link; the dev server has none, so hand the call to the real handler
  await context.route('**/api/chain-link', async (route) => {
    const req = route.request();
    const r = await fetch(`${SHIM}/api/chain-link`, { method: req.method(), headers: { 'content-type': 'application/json', authorization: req.headers().authorization || '' }, body: req.postData() || undefined });
    await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
  });
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const text = async (sel) => ((await page.locator(sel).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const waitText = async (sel, re, what, ms = 25_000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) { last = await text(sel); if (re.test(last)) return last; await page.waitForTimeout(250); }
    throw new Error(`timed out waiting for ${what}: last saw "${last.slice(0, 200)}"`);
  };

  await page.goto(`${WEB}/e2e/onchain.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="stable-panel"]', { timeout: 60_000 });

  // ================================================================ ICEC-S, the stable form
  log('ICEC-S: connect, deposit, redeem');
  await page.getByRole('button', { name: 'Connect wallet' }).click({ timeout: 1500 }).catch(() => {});     // a wallet that already trusts the site connects by itself
  await waitText('[data-testid="reserve-balance"]', /^1,000$/, `the wallet's ${symbol} balance`);
  check(`the panel reads the wallet's ${symbol} balance from the chain`, true);
  check('and shows no ICEC-S yet', (await text('[data-testid="stable-balance"]')).startsWith('0'));

  await page.getByLabel('Amount', { exact: true }).fill('250');
  await page.getByRole('button', { name: `Approve 250 ${symbol}` }).click();
  await page.getByRole('button', { name: 'Get ICEC-S' }).waitFor({ timeout: 25_000 });
  check('approval is a separate, exact-amount step', (await usdc.allowance(userWallet.address, await vault.getAddress())) === 250n * 10n ** 6n);
  await page.getByRole('button', { name: 'Get ICEC-S' }).click();
  await waitText('[data-testid="stable-balance"]', /^250/, 'the ICEC-S balance after depositing');
  check('depositing 250 gives exactly 250 ICEC-S, one for one', (await iceS.balanceOf(userWallet.address)) === 250n * 10n ** 6n);
  check('the vault holds exactly the 250 deposited', (await usdc.balanceOf(await vault.getAddress())) === 250n * 10n ** 6n);
  check('the screen shows the shilling value at the oracle\'s rate (250 x 3,700)', /UGX 925,000/.test(await text('[data-testid="stable-panel"]')));
  const porText = await waitText('[data-testid="proof-of-reserve"]', /100\.00%/, 'the proof of reserve');
  check('the proof of reserve is read live from the chain and says every ICEC-S is covered', /every ICEC-S is covered/.test(porText), porText);
  await shot('1-stable-after-deposit');

  await page.getByRole('tab', { name: `Back to ${symbol}` }).click();
  await page.getByLabel('Amount', { exact: true }).fill('50');
  await page.getByRole('button', { name: `Swap back to ${symbol}` }).click();
  await waitText('[data-testid="stable-balance"]', /^200/, 'the ICEC-S balance after redeeming');
  check('redeeming 50 returns exactly 50 of the stablecoin', (await usdc.balanceOf(userWallet.address)) === 800n * 10n ** 6n);
  const [held, supply] = await vault.collateralization();
  check('after every step the vault holds at least what it has issued (200 = 200)', held === 200n * 10n ** 6n && supply === 200n * 10n ** 6n);
  check('the tokens were never in IcanEra\'s hands: the database has no record of them', Number(psql('SELECT count(*) FROM icanera_chain.bridge_withdrawals')) === 0);

  // ================================================================ ICEC-C, the community form
  log('ICEC-C: link, withdraw, cancel, mint, burn back');
  await page.getByRole('tab', { name: 'ICEC-C · community' }).click();
  await page.waitForSelector('[data-testid="community-panel"]');
  await waitText('[data-testid="ledger-balance"]', /^500$/, 'the ledger balance');
  check('the panel shows the account\'s 500 ICEC in IcanEra and none on-chain', (await text('[data-testid="onchain-balance"]')).startsWith('0'));

  await page.getByRole('button', { name: /^Link 0x/ }).click();
  await waitText('[data-testid="community-panel"]', /Wallet linked\./, 'the link to be recorded');
  const linkedRow = psql(`SELECT address || '|' || user_id FROM icanera_chain.user_addresses`);
  check('linking recorded this address for this account, after a real signature check by the real endpoint', linkedRow === `${userWallet.address.toLowerCase()}|${USER_ID}`, linkedRow);
  const sigRow = psql('SELECT length(signature) FROM icanera_chain.user_addresses');
  check('and kept the proof (a 65-byte signature)', sigRow === '132', sigRow);

  const amountBox = page.getByLabel('Amount to move onto the chain');
  await amountBox.fill('7');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await waitText('[data-testid="community-panel"]', /Started\./, 'the first withdrawal to start');
  check('a withdrawal locks the ICEC at once: wallet 493, locked 7', ledger() === 493 && locked() === 7);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await waitText('[data-testid="community-panel"]', /Cancelled\. The ICEC is back/, 'the cancel');
  check('cancelling while it is still queued refunds it in full: wallet 500, locked 0', ledger() === 500 && locked() === 0);

  await amountBox.fill('20');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await waitText('[data-testid="community-panel"]', /Started\. 20 ICEC/, 'the real withdrawal to start');
  check('the real withdrawal: wallet 480, locked 20, one pending row', ledger() === 480 && locked() === 20 && psql("SELECT count(*) FROM icanera_chain.bridge_withdrawals WHERE status = 'pending'") === '1');

  log('the relayer runs');
  let s = await sync();
  check('the relayer signed and sent exactly one mint for it', s.sent.length === 1 && s.errors.length === 0, JSON.stringify(s));
  check('the withdrawal is now "submitted" with the hash of the transaction that was sent', psql("SELECT status || ':' || (tx_hash = '" + s.sent[0].tx + "')::text FROM icanera_chain.bridge_withdrawals WHERE status <> 'cancelled'") === 'submitted:true');
  await mine(2);
  s = await sync();
  check('after confirmation depth the relayer records the Minted event and the withdrawal is final', s.mintsRecorded === 1 && psql("SELECT count(*) FROM icanera_chain.bridge_withdrawals WHERE status = 'minted'") === '1', JSON.stringify(s));
  check('the relayer cross-checked the chain\'s total supply against the ledger, and they agree', s.supply?.ok === true && s.halted === false, JSON.stringify(s.supply));
  check('the user\'s wallet holds exactly 20 ICEC-C on-chain', (await iceC.balanceOf(userWallet.address)) === 20n * 10n ** 8n);
  s = await sync();
  check('a second run changes nothing (no double mint, no double record)', s.sent.length === 0 && s.mintsRecorded === 0 && s.errors.length === 0, JSON.stringify(s));

  await page.getByRole('button', { name: 'Refresh' }).click();
  await waitText('[data-testid="onchain-balance"]', /^20$/, 'the on-chain ICEC-C balance in the panel');
  check('the panel shows 20 ICEC-C on-chain and 480 in IcanEra', (await text('[data-testid="ledger-balance"]')) === '480');
  await shot('2-community-minted');

  const refusal = await iceC.connect(userWallet.connect(provider)).transfer.staticCall(guardian.address, 1n).then(() => 'moved', (e) => String(e.message));
  check('ICEC-C cannot be transferred: the contract refuses even the holder', /NonTransferable/.test(refusal) || refusal !== 'moved', refusal.slice(0, 120));

  await page.getByLabel('Amount to bring back').fill('5');
  await page.getByRole('button', { name: 'Bring back to IcanEra' }).click();
  await waitText('[data-testid="community-panel"]', /Done\. It returns/, 'the burn to confirm');
  check('burning 5 on-chain: the wallet has 15 left, supply 15', (await iceC.balanceOf(userWallet.address)) === 15n * 10n ** 8n && (await iceC.totalSupply()) === 15n * 10n ** 8n);
  check('and IcanEra has not credited anything yet (it waits for confirmation depth)', ledger() === 480);
  await mine(2);
  s = await sync();
  check('after confirmation the relayer records the burn and the database credits it once', s.burnsCredited === 1 && ledger() === 485 && locked() === 15, JSON.stringify(s));
  s = await sync();
  check('re-reading the same burn never credits it twice', ledger() === 485 && s.burnsCredited === 0, JSON.stringify(s));
  check('ICEC is conserved across the whole journey: wallet 485 + locked 15 = the 500 it started with', ledger() + locked() === 500);
  check('the ledger side of the books reconciles', reconcile().ok === true, JSON.stringify(reconcile()));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await waitText('[data-testid="ledger-balance"]', /^485$/, 'the credited balance');
  await waitText('[data-testid="community-panel"]', /Back in IcanEra/, 'the burn to be listed as credited');
  await shot('3-community-burned-back');

  // ================================================================ an incident: a mint nobody asked for (a stolen operator key)
  log('incident: the operator key mints to an attacker with no withdrawal behind it');
  const attacker = acct(5);
  const cWithKey = iceC.connect(relayerKey);
  await (await cWithKey.mint(attacker.address, 1000n * 10n ** 8n, ethers.hexlify(ethers.randomBytes(32)))).wait();
  await mine(2);
  s = await sync();
  check('the relayer reports the unknown mint; the database halts the bridge and records an anomaly', s.halted === true && psql('SELECT bridge_enabled FROM icanera_chain.chain_settings') === 'f' && psql("SELECT count(*) FROM icanera_chain.anomalies WHERE kind = 'unknown_mint' AND resolved_at IS NULL") === '1', JSON.stringify(s));
  const iceCAttacker = iceC.connect(attacker.connect(provider));
  await (await iceCAttacker.burnForCredit(1000n * 10n ** 8n, ethers.hexlify(ethers.randomBytes(32)))).wait();
  await mine(2);
  s = await sync();
  check('the attacker burning it for credit gets NOTHING: no account owns that address, the ledger does not move', ledger() === 485 && locked() === 15 && psql("SELECT status || ':' || reason FROM icanera_chain.bridge_deposits WHERE from_address = '" + attacker.address.toLowerCase() + "'") === 'unclaimed:address_not_linked', JSON.stringify(s));
  check('ICEC is still conserved after the attack: 485 + 15 = 500', ledger() + locked() === 500);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'ICEC-C · community' }).click();
  await amountBox.fill('3');
  const reviewDisabled = await page.getByRole('button', { name: 'Review', exact: true }).isDisabled();
  await waitText('[data-testid="community-panel"]', /paused right now/, 'the pause notice');
  check('while halted the screen says moving ICEC onto the chain is paused and will not let a new withdrawal start', reviewDisabled);
  const blocked = await relayerDb.rpc('ican_chain_operator_next_mints', { p_limit: 10, p_stale_s: 1 });
  check('and the relayer is offered no mints at all', Array.isArray(blocked) && blocked.length === 0);
  await shot('4-halted');

  check('the relayer wrote the blanked token, reserve and symbol back from the vault on its own',
    psql("SELECT lower(stable_token_address) = '" + (await iceS.getAddress()).toLowerCase() + "' AND lower(reserve_token_address) = '" + (await usdc.getAddress()).toLowerCase() + "' AND reserve_token_symbol = '" + symbol + "' FROM icanera_chain.chain_settings") === 't');
  check('no page error was thrown in the browser', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\nOK: ${results.length} end-to-end checks passed. Screenshots and logs: ${OUT}`);
} catch (e) {
  console.error(`\nFAILED: ${e.message}\nLogs and screenshots: ${OUT}`);
  if (page) {
    await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('page text:', ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 600));
    console.error('browser console (last 12):\n' + consoleLines.slice(-12).join('\n'));
  }
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await shim?.close().catch(() => {});
  await cleanup();
  if (!process.env.E2E_KEEP) { try { sh('psql', ['-X', '-q', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${DB}"`]); } catch { /* best effort */ } }
  setTimeout(() => process.exit(process.exitCode || 0), 500);
}
