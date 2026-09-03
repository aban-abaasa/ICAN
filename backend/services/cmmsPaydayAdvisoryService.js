/**
 * Enriches "today is payday" notifications with a one-line AI prosperity
 * recommendation.
 *
 * cmms_queue_payday_advisory() (backend/CMMS_PAYDAY_ADVISORY_NOTIFICATIONS.sql)
 * writes the fact-only "You're being paid X today (~ Y ICAN)" notification
 * instantly, inline inside the same transaction as the actual payroll
 * payment, and drops a row into cmms_payday_advisories with the real facts
 * (live ICAN rate, the employee's active Trust Group memberships, PitchIn
 * businesses currently selling shares). An OpenAI/Gemini call has no place
 * blocking a payroll payment, so that row is left `status = 'pending'` for
 * this worker to pick up a few seconds later and turn into a short,
 * data-grounded recommendation appended to that same notification — the
 * same Copilot voice used in SearchModal.jsx's chat, reusing the identical
 * aiProviderService.callAI() the rest of the backend already goes through.
 */

const { createClient } = require('@supabase/supabase-js');
const { callAI } = require('./aiProviderService');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

const SYSTEM_PROMPT = `You are IcanEra Copilot, giving a payday employee ONE short, specific, encouraging line of financial/prosperity advice.
Rules:
- Maximum 2 sentences. No greeting, no preamble, no generic "save some money" filler.
- Only reference numbers, group names, or business names that appear in the DATA block below — never invent one.
- If DATA.trust_groups is non-empty, you may suggest putting part of this pay toward one of them by name.
- If DATA.share_offers is non-empty, you may suggest considering a stake in one of them by name.
- If both are empty, give one concrete savings/investment habit sized to the amount paid.
- Plain text only, no markdown, no emoji beyond at most one.`;

async function generateAdvice(facts) {
  const { content, provider } = await callAI({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `DATA: ${JSON.stringify(facts)}` }
    ],
    temperature: 0.6,
    maxTokens: 120
  });
  return { text: content.trim(), provider };
}

/**
 * Processes up to 25 oldest pending payday advisories per call. Each
 * success appends "💡 <advice>" to the notification's existing message and
 * marks the advisory 'advised'; each failure marks it 'failed' (the
 * fact-only notification the employee already has stays useful on its
 * own — this is enrichment, not the primary payload).
 */
async function processPendingPaydayAdvisories() {
  const supabase = getSupabase();

  const { data: rows, error } = await supabase
    .from('cmms_payday_advisories')
    .select('id, notification_id, facts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(25);

  if (error) throw error;
  if (!rows || rows.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const { text: advice, provider } = await generateAdvice(row.facts || {});

      if (row.notification_id) {
        const { data: notif } = await supabase
          .from('cmms_notifications')
          .select('message')
          .eq('id', row.notification_id)
          .maybeSingle();

        if (notif) {
          await supabase
            .from('cmms_notifications')
            .update({ message: `${notif.message}\n\n💡 ${advice}` })
            .eq('id', row.notification_id);
        }
      }

      await supabase
        .from('cmms_payday_advisories')
        .update({ status: 'advised', advice_text: advice, advice_provider: provider, processed_at: new Date().toISOString() })
        .eq('id', row.id);

      processed++;
    } catch (err) {
      console.error(`[payday-advisory] Failed for advisory ${row.id}:`, err.message);
      await supabase
        .from('cmms_payday_advisories')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', row.id);
      failed++;
    }
  }

  console.log(`[payday-advisory] Processed ${processed}, failed ${failed}`);
  return { processed, failed };
}

module.exports = { processPendingPaydayAdvisories };
