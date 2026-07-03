/**
 * 🧪 LANDING MOCK TRADE SERVICE
 * Records simulated (not real) invest/buy/sell actions taken on the
 * ICANera landing page (public.landing_mock_trades). No real money,
 * equity, or wallet balance is ever touched here — see
 * ICAN/backend/db/create_landing_mock_trades_table.sql for the schema
 * and RLS policy this relies on.
 */

import { getSupabase } from './pitchingService';

export const ORIGIN_APP = 'ican';

// Fire-and-forget: a failed ticker write must never block showing the
// computed mock result to the user, so this never throws.
export const recordMockTrade = async ({ kind, targetType = null, targetId = null, guestKey, authId, inputAmount, computedResult }) => {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const { data, error } = await sb.from('landing_mock_trades').insert({
      guest_key: authId ? null : (guestKey || null),
      auth_id: authId || null,
      kind,
      target_type: targetType,
      target_id: targetId,
      input_amount: inputAmount,
      computed_result: computedResult || {},
      origin_app: ORIGIN_APP,
    }).select().single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[landingMockTradeService] failed to record mock trade:', err);
    return null;
  }
};

export const fetchRecentMockTrades = async (limit = 10) => {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('landing_mock_trades')
    .select('id, kind, target_type, target_id, input_amount, computed_result, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[landingMockTradeService] failed to fetch recent mock trades:', error);
    return [];
  }
  return data || [];
};

export const subscribeToMockTrades = (onInsert) => {
  const sb = getSupabase();
  if (!sb) return () => {};

  const channel = sb
    .channel('landing_mock_trades_public')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'landing_mock_trades' },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => sb.removeChannel(channel);
};
