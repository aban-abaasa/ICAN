/**
 * The IcanEra wallet's "send IcanEra coin" flow, in every direction between a
 * personal wallet and a business wallet:
 *
 *   personal → personal   transfer_ican
 *   personal → business   transfer_ican_to_business
 *   business → personal   pitchin_business_wallet_transfer             (+ approval)
 *   business → business   pitchin_business_wallet_transfer_to_business (+ approval)
 *
 * Kept out of ICANWallet.jsx and free of React / the Supabase client import so it
 * can be unit tested (tests/coinSendFlow.test.js): everything it touches —
 * database lookups, PIN prompts, the confirm box, the transfer calls — is passed
 * in. ICANWallet.jsx wires the real ones.
 */

import {
  classifyRecipient,
  phoneLookupVariants,
  pickRecipientAccount,
  planCoinTransfer,
} from '../utils/walletRouting.js';

/**
 * Who does this recipient string point at? One lookup shared by every IcanEra
 * send and the live "who is this?" preview, so they always agree.
 *
 * A phone or email can match a personal AND a business account of the same
 * owner (they share both). pickRecipientAccount settles that — personal unless a
 * business account number was typed — instead of failing with "multiple rows",
 * which used to make those people impossible to pay.
 *
 * @returns {Promise<{userId, businessProfileId, name, accountType, identifier} | {error: string}>}
 */
export async function resolveRecipientWallet(supabase, identifier, { countryCallingCode = null } = {}) {
  const parsed = classifyRecipient(identifier);
  if (parsed.kind === 'empty') return { error: 'Enter who to send to' };

  // A leading-3 address is a PitchIn business's IcanEra coin wallet, not a
  // user_accounts.account_number.
  if (parsed.kind === 'business_wallet') {
    const { data, error } = await supabase.rpc('resolve_ican_business_wallet', {
      p_wallet_address: parsed.value,
    });
    const businessWallet = Array.isArray(data) ? data[0] : data;
    if (error || !businessWallet) {
      return { error: `Business account not found: ${parsed.value}${error ? ` (${error.message})` : ''}` };
    }
    return {
      userId: null,
      businessProfileId: businessWallet.business_profile_id,
      name: businessWallet.business_name || parsed.value,
      accountType: 'business',
      identifier: parsed.value,
    };
  }

  let query = supabase
    .from('user_accounts')
    .select('user_id, account_holder_name, account_number, account_type, business_id');
  if (parsed.kind === 'account') {
    query = query.eq('account_number', parsed.value);
  } else if (parsed.kind === 'email') {
    query = query.eq('email', parsed.value);
  } else {
    const variants = phoneLookupVariants(parsed.value, { countryCallingCode });
    query = query.in('phone_number', variants.length ? variants : [parsed.value]);
  }
  const { data, error } = await query.limit(10);
  const { account, accountType } = pickRecipientAccount(data, {
    prefer: parsed.kind === 'account' ? parsed.accountType : 'personal',
  });
  if (error || !account) {
    return { error: `Recipient not found: ${identifier}${error ? ` (${error.message})` : ''}` };
  }
  return {
    userId: account.user_id,
    businessProfileId: accountType === 'business' ? (account.business_id || null) : null,
    name: account.account_holder_name,
    accountType,
    identifier: parsed.value,
  };
}

/** A server error, in words the person can act on. */
export function describeSendError(error) {
  const raw = error?.message || 'Icaneracoin transfer failed';
  if (/business wallet not found or inactive/i.test(raw)) {
    return "That business hasn't activated its IcanEra wallet yet, so it can't receive IcanEra coin.";
  }
  if (error?.requestId) {
    return `${raw} (Payment request ${error.requestId} was created — see it in the business administrator's inbox.)`;
  }
  return raw;
}

const fmt = (n) => Number(n).toFixed(4);

/**
 * Run one coin send, start to finish: look the recipient up, work out the route,
 * check the balance, confirm, take the right PIN, move the money.
 *
 * Authorising: a personal sender uses their wallet PIN. A business
 * administrator uses the business-wallet PIN, which submits AND approves in one
 * go. A non-administrator (e.g. an assigned finance user) just submits a request
 * — approval is the administrator's, so they need no PIN.
 *
 * Expected problems come back as `{ success: false, message }` and a cancelled
 * confirm/PIN as `{ cancelled: true }`; nothing has moved in either case. Server
 * errors from the transfer calls are thrown (see describeSendError).
 *
 * @param {object} p
 * @param {object} p.supabase
 * @param {string} p.currentUserId
 * @param {object|null} p.sendFromBusiness business profile (with .ican_wallet) the money leaves, or null for the personal wallet
 * @param {boolean|null} p.sendFromIsAdmin already-known admin status, or null to look it up
 * @param {string} p.recipientIdentifier
 * @param {string|number} p.amount
 * @param {string} [p.description]
 * @param {string|null} [p.countryCallingCode]
 * @param {(req: {title: string, message: string}) => Promise<string|null>} p.askPin
 * @param {(message: string) => boolean} p.confirm
 * @param {(userId: string, pin: string) => Promise<{success: boolean, error?: string}>} p.verifyUserPIN
 * @param {(businessProfileId: string, pin: string) => Promise<{success: boolean, error?: string}>} p.verifyBusinessWalletPin
 * @param {() => Promise<number>} [p.getPersonalBalance] the sender's coin balance, checked before any PIN is asked
 * @param {{sendIcaneracoin: Function, sendICANToBusiness: Function, sendFromBusinessWallet: Function, isBusinessWalletAdmin: Function}} p.api
 * @returns {Promise<{cancelled: true} | {success: false, message: string} | {success: true, message: string, transactionId: string, pendingApproval: boolean, touchesBusiness: boolean}>}
 */
export async function runCoinSend({
  supabase, currentUserId, sendFromBusiness = null, sendFromIsAdmin = null,
  recipientIdentifier, amount, description = '', countryCallingCode = null,
  askPin, confirm, verifyUserPIN, verifyBusinessWalletPin, getPersonalBalance = null, api,
}) {
  const fail = (message) => ({ success: false, message });

  const parsedAmount = parseFloat(amount);
  if (!(parsedAmount > 0)) return fail('Enter a valid IcanEra amount');

  const recipient = await resolveRecipientWallet(supabase, recipientIdentifier, { countryCallingCode });
  if (recipient.error) return fail(recipient.error);

  const fromWallet = sendFromBusiness
    ? { type: 'business', businessProfileId: sendFromBusiness.id }
    : { type: 'personal', userId: currentUserId };
  const toWallet = recipient.businessProfileId
    ? { type: 'business', businessProfileId: recipient.businessProfileId }
    : { type: 'personal', userId: recipient.userId };
  const plan = planCoinTransfer({ from: fromWallet, to: toWallet });
  if (!plan.route) return fail(plan.error);

  const senderName = sendFromBusiness ? sendFromBusiness.business_name : 'your personal wallet';
  const recipientKind = toWallet.type === 'business' ? 'business' : 'personal';
  const recipientName = recipient.name || recipient.identifier;

  if (sendFromBusiness) {
    const available = Number(sendFromBusiness.ican_wallet?.ican_balance || 0);
    if (parsedAmount > available) {
      return fail(`${senderName} has only ${fmt(available)} IcanEra, not enough to send ${fmt(parsedAmount)}.`);
    }
  }

  // Don't ask for a PIN just to be told there isn't enough. If the balance can't
  // be read, carry on — the database enforces it anyway.
  if (!sendFromBusiness && getPersonalBalance) {
    let available = NaN;
    try { available = Number(await getPersonalBalance()); } catch { /* ignore */ }
    if (Number.isFinite(available) && parsedAmount > available) {
      return fail(`You have ${fmt(available)} IcanEra, not enough to send ${fmt(parsedAmount)}.`);
    }
  }

  const isAdmin = sendFromBusiness
    ? (sendFromIsAdmin ?? await api.isBusinessWalletAdmin(sendFromBusiness.id, {
      ownerUserId: sendFromBusiness.user_id, currentUserId,
    }))
    : false;
  const needsApproval = Boolean(sendFromBusiness) && !isAdmin;

  // The recipient was looked up above, so this name is an actual account
  // holder, not just whatever the sender typed.
  const confirmed = confirm(
    `Send ${fmt(parsedAmount)} IcanEra from ${senderName} to ${recipientName} (${recipientKind} account)?\n\n` +
    `Verified IcanEra ${recipientKind} account: ${recipient.identifier}` +
    (needsApproval ? "\n\nYou can't approve payments from this business, so this will be sent to its administrator as a request." : ''),
  );
  if (!confirmed) return { cancelled: true };

  let pin = null;
  if (sendFromBusiness && !needsApproval) {
    pin = await askPin({
      title: 'Business wallet PIN',
      message: `Enter the business-wallet PIN to send ${fmt(parsedAmount)} IcanEra from ${senderName}.`,
    });
    if (pin === null) return { cancelled: true };
    const check = await verifyBusinessWalletPin(sendFromBusiness.id, pin);
    if (!check?.success) return fail(check?.error || 'Incorrect business-wallet PIN. Transfer cancelled.');
  } else if (!sendFromBusiness) {
    pin = await askPin({ title: 'Confirm transfer', message: 'Enter your transaction PIN to send this IcanEra.' });
    if (pin === null) return { cancelled: true };
    const check = await verifyUserPIN(currentUserId, pin);
    if (!check?.success) return fail(check?.error || 'Incorrect transaction PIN. Transfer cancelled.');
  }

  const note = description || `Transfer to ${recipientName}`;
  let transactionId;
  let pendingApproval = false;

  if (plan.route === 'user_to_user') {
    const result = await api.sendIcaneracoin({
      fromUserId: currentUserId, toUserId: recipient.userId, amount: parsedAmount, note,
    });
    transactionId = result.tx_id;
  } else if (plan.route === 'user_to_business') {
    const result = await api.sendICANToBusiness({
      fromUserId: currentUserId, businessProfileId: recipient.businessProfileId, amount: parsedAmount, note,
    });
    transactionId = result.out_tx_id;
  } else {
    const result = await api.sendFromBusinessWallet({
      businessProfileId: sendFromBusiness.id,
      recipientUserId: toWallet.type === 'personal' ? recipient.userId : null,
      recipientBusinessProfileId: toWallet.type === 'business' ? recipient.businessProfileId : null,
      amount: parsedAmount,
      note,
      pin,
      isAdmin,
    });
    transactionId = result.transactionId;
    pendingApproval = result.status !== 'completed';
  }

  return {
    success: true,
    pendingApproval,
    transactionId,
    touchesBusiness: Boolean(sendFromBusiness) || toWallet.type === 'business',
    message: pendingApproval
      ? `📨 Request sent: ${fmt(parsedAmount)} IcanEra from ${senderName} to ${recipientName}. The business administrator must approve it with the business-wallet PIN before it is paid.`
      : `✅ Sent ${fmt(parsedAmount)} IcanEra from ${senderName} to ${recipientName}. No fee — they receive the full amount.`,
  };
}
