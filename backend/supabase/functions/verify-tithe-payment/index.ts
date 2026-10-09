// Supabase Edge Function: settle a church tithe paid through Flutterwave checkout.
//
// The browser only ever holds Flutterwave's PUBLIC key, so it cannot be trusted to say
// "this payment succeeded". This function takes the transaction id the checkout returned,
// asks Flutterwave (with the SECRET key) what actually happened, and only then calls
// fn_settle_church_tithe_flutterwave -- which is executable by the service role alone --
// to record the tithe and credit the church. Replaying the same tx_ref is a no-op.
//
// Secrets: FLUTTERWAVE_SECRET_KEY (plus the SUPABASE_* ones the platform injects).
// Deploy:  supabase functions deploy verify-tithe-payment
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (name: string) => (Deno.env.get(name) ?? '').trim().replace(/^["']|["']$/g, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const GIVING_TYPES = ['tithe', 'offering', 'charity', 'mission', 'building_fund', 'alms', 'other'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const flwSecret = env('FLUTTERWAVE_SECRET_KEY');
  if (!supabaseUrl || !serviceKey || !flwSecret) return json({ success: false, error: 'Payment verification is not configured' }, 500);

  // Who is giving: taken from their session, never from the request body.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: auth, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !auth?.user) return json({ success: false, error: 'Please sign in again' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: 'Invalid request' }, 400); }

  const transactionId = String(body.transaction_id ?? '');
  const txRef = String(body.tx_ref ?? '');
  const businessId = String(body.business_id ?? '');
  const amount = Math.floor(Number(body.amount) || 0);
  const givingType = GIVING_TYPES.includes(String(body.giving_type)) ? String(body.giving_type) : 'tithe';
  if (!transactionId || !txRef || !businessId || amount <= 0) return json({ success: false, error: 'Missing payment details' }, 400);

  // Ask Flutterwave what really happened.
  const flwRes = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
  });
  const flw = await flwRes.json().catch(() => null);
  const tx = flw?.data;
  if (!flwRes.ok || flw?.status !== 'success' || !tx) return json({ success: false, error: 'Could not confirm the payment with Flutterwave' }, 402);
  if (tx.status !== 'successful') return json({ success: false, error: `Payment is ${tx.status ?? 'not complete'}` }, 402);
  if (tx.tx_ref !== txRef) return json({ success: false, error: 'Payment reference mismatch' }, 400);
  if (tx.currency !== 'UGX') return json({ success: false, error: 'Only UGX payments can be settled here' }, 400);
  // The church is credited what was actually charged, never more than the giver asked for.
  const charged = Math.floor(Number(tx.charged_amount ?? tx.amount) || 0);
  if (charged < amount) return json({ success: false, error: 'The amount charged was less than the tithe amount' }, 400);

  const { data, error } = await admin.rpc('fn_settle_church_tithe_flutterwave', {
    p_user_id: auth.user.id,
    p_business_id: businessId,
    p_amount: amount,
    p_giving_type: givingType,
    p_is_anonymous: body.is_anonymous === true,
    p_message: typeof body.message === 'string' ? body.message : null,
    p_tithe_type: body.tithe_type === 'business' ? 'business' : 'personal',
    p_tx_ref: txRef,
    p_flw_transaction_id: transactionId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.success) {
    // Money was taken but the credit did not land: say so, with the reference, so nobody pays twice.
    return json({ success: false, paid: true, error: row?.message || error?.message || 'Payment received but not yet recorded', tx_ref: txRef }, 500);
  }

  return json({
    success: true,
    tithe_record_id: row.tithe_record_id,
    church_name: row.church_name,
    message: row.message,
    already_processed: !!row.already_processed,
  });
});
