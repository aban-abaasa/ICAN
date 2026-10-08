/**
 * Receipt helpers for ledger transactions.
 *
 * Every transaction gets a receipt: either the proof image the user attached
 * (stored as an r2:// value in metadata.receipt_url via the existing R2 upload
 * flow) or a system receipt generated from the ledger row itself. Nothing here
 * calls the network -- images are resolved/uploaded through r2StorageService.
 */

export const RECEIPT_FOLDER = 'transaction-receipts';
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

const shortId = (value) => String(value || '').replace(/-/g, '').slice(0, 8).toUpperCase();

/** Receipt number from a date + source id, e.g. RCT-20260314-A1B2C3D4 */
export const makeReceiptNumber = (dateValue, id) => {
  const date = new Date(dateValue);
  const day = Number.isNaN(date.getTime()) ? '00000000' : date.toISOString().slice(0, 10).replace(/-/g, '');
  return `RCT-${day}-${shortId(id) || 'LOCAL'}`;
};

/** Stable receipt number for a ledger row (a number stamped in metadata wins). */
export const getReceiptNumber = (tx) => {
  if (!tx) return '';
  const stamped = tx.metadata?.receipt_number;
  if (stamped) return stamped;
  return makeReceiptNumber(tx.created_at, tx.id || tx.metadata?.receipt_id || tx.metadata?.reference_id);
};

/** The attached proof image reference (r2:// or https://), or null. */
export const getReceiptImageRef = (tx) => tx?.metadata?.receipt_url || null;

/** External receipt/reference number typed in by the user (shop receipt, mobile-money ref, church receipt book...). */
export const getReceiptRef = (tx) => (tx?.metadata?.receipt_ref || '').toString().trim() || null;

/** 'attached' = proof photo, 'reference' = receipt number only, 'system' = generated from the ledger row. */
export const getProofStatus = (tx) => (getReceiptImageRef(tx) ? 'attached' : getReceiptRef(tx) ? 'reference' : 'system');

export const getProofLabel = (tx) => ({
  attached: getReceiptRef(tx) ? 'Photo + receipt no.' : 'Receipt photo attached',
  reference: 'Receipt no. recorded',
  system: 'System receipt',
}[getProofStatus(tx)]);

// Gateway keywords that mean a transaction went through an automated/digital
// channel; anything else (cash, agent entry, admin adjustment, no method
// recorded at all) is treated as manually handled.
const DIGITAL_PAYMENT_KEYWORDS = ['momo', 'mobile money', 'mtn', 'airtel', 'vodafone', 'card', 'visa', 'mastercard', 'verve', 'flutterwave', 'ussd'];
const DIGITAL_SOURCE_APPS = ['digital-city-era', 'farm-agent', 'mybodaguy', 'ican'];

/** 'digital' (shared coin ledger, gateway payments, platform apps) or 'manual' (everything a person typed in). */
export const getTransactionChannel = (tx) => {
  const stamped = tx?.metadata?.entry_channel;
  if (stamped === 'digital' || stamped === 'manual') return stamped;
  const method = (tx?.metadata?.paymentMethod || tx?.metadata?.method || '').toString().toLowerCase();
  const sourceApp = (tx?.source_app || tx?.metadata?.source_app || '').toString().toLowerCase();
  const isSharedLedger = String(tx?.id || '').startsWith('shared-') || Boolean(tx?.ican_amount);
  const isDigital = isSharedLedger || DIGITAL_SOURCE_APPS.includes(sourceApp)
    || DIGITAL_PAYMENT_KEYWORDS.some((keyword) => method.includes(keyword));
  return isDigital ? 'digital' : 'manual';
};

/** True when the entry names a second party: a payer, a recipient, a merchant or a counterparty. */
export const isTwoParty = (tx) => {
  if (!tx) return false;
  const meta = tx.metadata || {};
  return Boolean(
    tx.counterparty_type || tx.merchant_name || tx.recipient_user_id || tx.sender_user_id
    || meta.payer_name || meta.recipient_name || meta.recipient || meta.counterparty_name
    || meta.merchant_name || meta.recipient_user_id || meta.sender_user_id,
  );
};

/**
 * Proof rule: a manually recorded entry between two parties is only fully
 * evidenced when BOTH a receipt photo and a receipt number are on file. Digital
 * entries are already evidenced by the platform ledger, and one-sided entries
 * have no counterparty to dispute them, so neither is asked for manual proof.
 */
export const getProofRequirement = (tx) => {
  const hasPhoto = Boolean(getReceiptImageRef(tx));
  const hasNumber = Boolean(getReceiptRef(tx));
  const required = isTwoParty(tx) && getTransactionChannel(tx) === 'manual';
  const missing = [];
  if (required && !hasPhoto) missing.push('Receipt photo');
  if (required && !hasNumber) missing.push('Receipt number');
  return { required, hasPhoto, hasNumber, missing, complete: required && missing.length === 0 };
};

const titleCase = (value) => String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Ordered [label, value] rows describing the transaction on its receipt. */
export const getReceiptLines = (tx, { businessName = null, currency = 'UGX' } = {}) => {
  const meta = tx?.metadata || {};
  const isIncome = tx?.transaction_type === 'income';
  const recordCategory = tx?.record_category || meta.record_category || 'personal';
  const lines = [
    ['Receipt No.', getReceiptNumber(tx)],
    ['Type', isIncome ? 'Money in (income)' : 'Money out (expense)'],
    ['Amount', `${Math.abs(Number(tx?.amount) || 0).toLocaleString()} ${tx?.currency || currency}`],
    ['Description', tx?.description || 'Transaction'],
    ['Date', tx?.created_at ? new Date(tx.created_at).toLocaleString() : '—'],
    ['Account', recordCategory === 'business' ? 'Business' : recordCategory === 'tithe' ? 'Tithe' : 'Personal'],
  ];
  if (businessName) lines.push(['Business', businessName]);
  const category = meta.categoryName || meta.category;
  if (category) lines.push(['Category', titleCase(category)]);
  if (meta.accounting_type) lines.push(['Accounting', titleCase(meta.accounting_type)]);
  if (meta.product_name) lines.push(['Item', meta.product_name]);
  if (meta.quantity) lines.push(['Quantity', String(meta.quantity)]);
  if (meta.unit_price) lines.push(['Unit price', `${Number(meta.unit_price).toLocaleString()} ${currency}`]);
  // A sale a customer listed themselves on the business's standing pay QR: one line per item.
  if (Array.isArray(meta.items)) {
    meta.items.slice(0, 20).forEach((it) => {
      const qty = Number(it?.qty) || 1;
      lines.push([`Item${qty > 1 ? ` × ${qty}` : ''}`, `${it?.name || 'Item'} — ${(Number(it?.price || 0) * qty).toLocaleString()} ${currency}`]);
    });
  }
  if (meta.payment_method) lines.push(['Method', titleCase(meta.payment_method)]);
  if (meta.payer_name) lines.push(['Paid by', meta.payer_name]);
  if (meta.recipient_name || meta.recipient) lines.push(['Received by', meta.recipient_name || meta.recipient]);
  if (meta.giving_type) lines.push(['Giving type', titleCase(meta.giving_type)]);
  if (meta.recipient_type) lines.push(['Given to', titleCase(meta.recipient_type)]);
  if (meta.is_anonymous) lines.push(['Giver', 'Anonymous']);
  if (meta.merchant_name) lines.push(['Merchant', meta.merchant_name]);
  const source = meta.source || meta.source_app;
  if (source) lines.push(['Recorded via', titleCase(source)]);
  if (meta.reference_id) lines.push(['Reference', String(meta.reference_id)]);
  if (getReceiptRef(tx)) lines.push(['Receipt ref', getReceiptRef(tx)]);
  const proof = getProofRequirement(tx);
  if (proof.required) lines.push(['Manual proof', proof.complete ? '100% — photo and receipt no.' : `Incomplete — missing ${proof.missing.join(' & ').toLowerCase()}`]);
  if (tx?.id && !String(tx.id).startsWith('temp_')) lines.push(['Ledger ID', String(tx.id)]);
  return lines;
};

/** Plain-text receipt, used for sharing/clipboard. */
export const getReceiptText = (tx, options, seal = null) =>
  ['IcanEra Transaction Receipt', ...getReceiptLines(tx, options).map(([k, v]) => `${k}: ${v}`), ...(seal ? [`Digital seal: ${seal.slice(0, 32)}…`] : [])].join('\n');

/**
 * Downscale big phone photos before upload so receipts stay small. Non-images
 * (e.g. PDFs) and anything that can't be decoded are returned unchanged.
 */
export const compressReceiptImage = async (file, { maxEdge = 1600, quality = 0.82 } = {}) => {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type) || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1024 * 1024) { bitmap.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch (error) {
    console.warn('Receipt image compression skipped:', error);
    return file;
  }
};

/**
 * Normalise a wallet-list row (ICANWallet's merged shared/legacy feed) into the
 * ledger-transaction shape the receipt helpers expect. Only legacy
 * ican_transactions rows keep a user_id, so only those can take an attached
 * proof image; shared coin-feed rows always get the system receipt.
 */
export const walletTxToReceiptTx = (tx) => {
  if (!tx) return null;
  const rawId = String(tx.id || '').replace(/^(shared|legacy)-/, '');
  const isLegacy = String(tx.id || '').startsWith('legacy-');
  const amount = Number(tx.local_amount ?? tx.amount) || 0;
  const incoming = Number(tx.amount) >= 0;
  return {
    id: rawId,
    user_id: isLegacy ? tx.user_id : null,
    amount: Math.abs(amount),
    currency: tx.currency || tx.local_currency || 'UGX',
    transaction_type: incoming ? 'income' : 'expense',
    description: tx.description || tx.transaction_type || 'Wallet transaction',
    created_at: tx.created_at,
    business_profile_id: tx.business_profile_id || null,
    metadata: {
      ...(tx.metadata || {}),
      category: tx.metadata?.category || tx.expense_classification || tx.transaction_type,
      source: tx.metadata?.source || tx.source_app || 'ican wallet',
      payment_method: tx.metadata?.payment_method || 'IcanEra wallet',
      entry_channel: getTransactionChannel(tx),
      merchant_name: tx.merchant_name || tx.metadata?.merchant_name || null,
      reference_id: tx.reference_id || tx.metadata?.reference_id || null,
      ican_amount: Math.abs(Number(tx.amount) || 0),
    },
  };
};

/**
 * Autograph: SHA-256 seal over the receipt's canonical lines, so any later
 * change to the amount/date/description produces a different seal. Returns
 * null where WebCrypto isn't available.
 */
export const signReceipt = async (tx, options) => {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const canonical = getReceiptLines(tx, options).map(([k, v]) => `${k}=${v}`).join('|');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
};

/**
 * Build a receipt-ready transaction from a tithe payment. The receipt number
 * is derived from the tithe record id, so the same number is stamped on the
 * matching ledger row and shown wherever the receipt is opened.
 */
export const titheToReceiptTx = ({ id, amount, currency = 'UGX', date, givingType, recipientType, paymentMethod, titheType, isAnonymous, description }) => ({
  id: id || null,
  user_id: null,
  amount: Math.abs(Number(amount) || 0),
  currency,
  transaction_type: 'expense',
  description: description || `${titleCase(givingType || 'tithe')} to ${recipientType || 'church'}`,
  created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
  record_category: 'tithe',
  metadata: {
    record_category: 'tithe',
    category: 'tithe',
    source: 'tithe page',
    receipt_number: makeReceiptNumber(date || new Date(), id),
    giving_type: givingType,
    recipient_type: recipientType,
    payment_method: paymentMethod,
    tithe_type: titheType,
    is_anonymous: Boolean(isAnonymous),
  },
});

/**
 * Tally of how many entries (and how much money) are backed by user-supplied
 * proof (photo or receipt number) versus system receipt only. Income and
 * expense amounts are summed by absolute value, since this is about coverage.
 */
export const getReceiptTally = (transactions = []) => {
  const tally = { total: 0, backed: 0, unbacked: 0, backedAmount: 0, unbackedAmount: 0, percent: 0 };
  transactions.forEach((t) => {
    const amount = Math.abs(Number(t?.amount) || 0);
    tally.total += 1;
    if (getProofStatus(t) === 'system') { tally.unbacked += 1; tally.unbackedAmount += amount; }
    else { tally.backed += 1; tally.backedAmount += amount; }
  });
  tally.percent = tally.total ? Math.round((tally.backed / tally.total) * 100) : 0;
  return tally;
};
