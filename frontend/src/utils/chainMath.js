// Pure helpers for the on-chain screens (ICEC-S the stable form, ICEC-C the community form). No network, no wallet: amounts are
// handled as exact integers (BigInt) in the token's smallest unit, never as floating point, so a screen can never show or send
// a number that differs from what the contract will do.

export const ICEC_C_DECIMALS = 8; // icaneracoin's ledger precision; ICEC-C uses the same, so 1 ICEC = 1e8 base units

const DECIMAL = /^\d*\.?\d*$/;

/** "12.5" -> 12500000n at 6 decimals. null for anything that is not a plain positive decimal that fits the token's precision. */
export const parseUnits = (text, decimals) => {
  const s = String(text ?? '').trim();
  if (!s || s === '.' || !DECIMAL.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  const units = BigInt(`${whole || '0'}${frac.padEnd(decimals, '0')}`);
  return units > 0n ? units : null;
};

/** 12500000n at 6 decimals -> "12.5". Trailing zeros are trimmed; `maxFrac` caps what is shown (rounds DOWN, never up). */
export const formatUnits = (units, decimals, maxFrac = decimals) => {
  if (units == null) return '—';
  let v = BigInt(units);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, Math.max(0, Math.min(maxFrac, decimals)));
  frac = frac.replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
};

/** The ledger's 8-decimal NUMERIC text ("12.34500000") <-> the contract's integer. */
export const ledgerToUnits = (text) => parseUnits(text, ICEC_C_DECIMALS);
export const unitsToLedger = (units) => formatUnits(units, ICEC_C_DECIMALS);

/**
 * Proof of reserve: what the vault holds against what it has issued. `backed` is the invariant the contract enforces
 * after every deposit and redemption (reserve >= supply); the screen shows it live from the chain.
 */
export const proofOfReserve = ({ reserve, supply }) => {
  if (reserve == null || supply == null) return null;
  const r = BigInt(reserve);
  const s = BigInt(supply);
  const backed = r >= s;
  return {
    backed,
    surplus: backed ? r - s : 0n,
    shortfall: backed ? 0n : s - r,
    // basis points of backing: 10000 = exactly 100.00 %, rounded down so it never flatters
    coverageBps: s === 0n ? 10000n : (r * 10000n) / s,
  };
};

/** A US-dollar amount in base units -> UGX (or any local currency) at a USD -> local rate. null when there is no usable rate. */
export const localValue = (units, decimals, usdRate) => {
  const rate = Number(usdRate);
  if (units == null || !(rate > 0) || !Number.isFinite(rate)) return null;
  // split into whole and fractional parts so a large balance does not lose precision before the multiplication
  const base = 10n ** BigInt(decimals);
  const v = BigInt(units);
  return Number(v / base) * rate + (Number(v % base) / Number(base)) * rate;
};

/** Is the wallet on the network the contracts live on? */
export const networkStatus = ({ walletChainId, expectedChainId }) => {
  if (!expectedChainId) return 'unconfigured';
  if (walletChainId == null) return 'unknown';
  return Number(walletChainId) === Number(expectedChainId) ? 'ok' : 'wrong';
};

export const shortAddress = (a) => (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
export const sameAddress = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

export const explorerLink = (base, kind, value) => {
  if (!base || !/^https:\/\//.test(base) || !value) return null;
  return `${String(base).replace(/\/$/, '')}/${kind === 'address' ? 'address' : 'tx'}/${value}`;
};

// ---- checks before a transaction is asked of the wallet -----------------------------------------------------------------------

/** Deposit reserve token -> ICEC-S. Returns { ok:true, units, needsApproval } or { ok:false, error }. */
export const checkDeposit = ({ amount, balance, allowance, decimals, depositsPaused = false }) => {
  if (depositsPaused) return { ok: false, error: 'Deposits are paused right now. You can still redeem.' };
  const units = parseUnits(amount, decimals);
  if (units == null) return { ok: false, error: amount ? `Enter an amount with at most ${decimals} decimal places.` : null };
  if (balance == null) return { ok: false, error: 'Connect your wallet to see your balance.' };
  if (units > BigInt(balance)) return { ok: false, error: 'That is more than you hold.' };
  return { ok: true, units, needsApproval: allowance == null || BigInt(allowance) < units };
};

/** Redeem ICEC-S -> reserve token. */
export const checkRedeem = ({ amount, balance, decimals }) => {
  const units = parseUnits(amount, decimals);
  if (units == null) return { ok: false, error: amount ? `Enter an amount with at most ${decimals} decimal places.` : null };
  if (balance == null) return { ok: false, error: 'Connect your wallet to see your balance.' };
  if (units > BigInt(balance)) return { ok: false, error: 'That is more than you hold.' };
  return { ok: true, units };
};

/** Burn ICEC-C back to the ledger. */
export const checkBurn = ({ amount, balance }) => {
  const units = parseUnits(amount, ICEC_C_DECIMALS);
  if (units == null) return { ok: false, error: amount ? `Enter an amount with at most ${ICEC_C_DECIMALS} decimal places.` : null };
  if (balance == null) return { ok: false, error: 'Connect your wallet to see your balance.' };
  if (units > BigInt(balance)) return { ok: false, error: 'That is more than you hold on-chain.' };
  return { ok: true, units };
};

/** Withdraw ledger ICEC -> ICEC-C. `ledgerBalance` and the limits are numbers from the app; the database re-checks everything. */
export const checkWithdraw = ({ amount, ledgerBalance, min, max, addressLinked }) => {
  const units = parseUnits(amount, ICEC_C_DECIMALS);
  if (units == null) return { ok: false, error: amount ? `Enter an amount with at most ${ICEC_C_DECIMALS} decimal places.` : null };
  const n = Number(amount);
  if (!addressLinked) return { ok: false, error: 'Link a wallet address first.' };
  if (min != null && n < Number(min)) return { ok: false, error: `The smallest amount is ${min} ICEC.` };
  if (max != null && n > Number(max)) return { ok: false, error: `The most you can move at once is ${max} ICEC.` };
  if (ledgerBalance != null && n > Number(ledgerBalance)) return { ok: false, error: 'That is more than your IcanEra balance.' };
  return { ok: true, units };
};

// ---- words ----------------------------------------------------------------------------------------------------------------------

/** What a wallet or node error means for a person. Never shows a raw stack or a key. */
export const friendlyChainError = (e) => {
  const code = e?.code ?? e?.error?.code ?? e?.info?.error?.code;
  const msg = String(e?.shortMessage || e?.reason || e?.message || '');
  if (code === 4001 || code === 'ACTION_REJECTED' || /user rejected|user denied|rejected the request/i.test(msg)) return 'You cancelled that in your wallet. Nothing was sent.';
  if (code === -32002) return 'Your wallet already has a request open. Open it and answer it first.';
  if (/insufficient funds/i.test(msg)) return 'Your wallet does not have enough of the network\'s coin to pay the fee.';
  if (/DepositsArePaused/.test(msg)) return 'Deposits are paused right now. You can still redeem.';
  if (/ERC20InsufficientBalance|exceeds balance/i.test(msg)) return 'That is more than you hold.';
  if (/NonTransferable/.test(msg)) return 'ICEC-C cannot be sent to another address. You can only bring it back to IcanEra.';
  if (/network|chain/i.test(msg) && /mismatch|changed|wrong/i.test(msg)) return 'Your wallet is on a different network. Switch network and try again.';
  return msg ? msg.slice(0, 160) : 'The transaction failed. Nothing was lost; please try again.';
};

const STATUS = {
  pending:   { label: 'Queued', help: 'Waiting to be sent to the chain. You can still cancel it.', tone: 'wait' },
  submitted: { label: 'Sending', help: 'Sent to the chain, waiting for it to be confirmed.', tone: 'wait' },
  minted:    { label: 'On-chain', help: 'In your wallet as ICEC-C.', tone: 'ok' },
  cancelled: { label: 'Cancelled', help: 'Returned to your IcanEra balance.', tone: 'off' },
};
export const withdrawalStatus = (w) => STATUS[w?.status] || { label: w?.status || 'Unknown', help: '', tone: 'off' };

export const burnStatus = (b) => (b?.status === 'credited'
  ? { label: 'Back in IcanEra', tone: 'ok' }
  : { label: 'Needs a look', tone: 'wait', help: b?.reason === 'address_not_linked' ? 'This address is not linked to your account.' : b?.reason === 'exceeds_outstanding' ? 'More than was bridged out to this address.' : 'Waiting for confirmations.' });

/** How old the oracle number is, in words, and whether to warn. */
export const rateFreshness = (fx) => {
  if (!fx?.available) return { text: 'No exchange rate yet', warn: true };
  const age = Number(fx.age_s) || 0;
  const t = age < 90 ? `${Math.max(0, Math.round(age))} s ago` : age < 5400 ? `${Math.round(age / 60)} min ago` : `${Math.round(age / 3600)} h ago`;
  return { text: `Rate updated ${t}`, warn: !!fx.stale };
};

/** The one wallet-style address inside pasted text: "0xAbC…", " 0xabc… ", '"0xabc…"', an explorer link to it, or the 40 digits with
 *  no 0x. Lower-cased. null when there is none, more than one DIFFERENT one (it will not guess), or when the only candidate is
 *  part of something longer (a 64-digit transaction hash is not an address). Mirrors icanera_chain.extract_address in the database. */
export const extractAddress = (text) => {
  const t = String(text ?? '');
  const found = new Set();
  for (const m of t.matchAll(/(?<![0-9a-zA-Z])0[xX]([0-9a-fA-F]{40})(?![0-9a-zA-Z])/g)) found.add(m[1].toLowerCase());
  if (found.size === 1) return `0x${[...found][0]}`;
  if (found.size === 0) {
    const bare = /^([0-9a-fA-F]{40})$/.exec(t.replace(/^[\s"'`<>()[\]]+|[\s"'`<>()[\]]+$/g, ''));
    if (bare) return `0x${bare[1].toLowerCase()}`;
  }
  return null;
};
