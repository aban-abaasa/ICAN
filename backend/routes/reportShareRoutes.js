import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Same Resend REST helper as emailRoutes.js (kept as a separate copy here,
// same as that file's own comment about the SendGrid->Resend swap, so this
// route has no import-order dependency on emailRoutes.js).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const sendEmail = async ({ to, from, subject, html }) => {
  try {
    await axios.post(
      'https://api.resend.com/emails',
      { from, to, subject, html },
      { headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message);
  }
};

const fromEmail = process.env.SENDER_EMAIL || 'aronnykevin@gmail.com';
const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminSupabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

// A share link's OTP step has no ICAN session to scope by -- the whole
// point is that an outside viewer never logs in -- so, same reasoning as
// storageRoutes.js's publicUploadRateLimit, this is locked down by a small
// in-memory per-IP limit instead of a caller-scoped token.
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const OTP_REQUEST_MAX_PER_WINDOW = 12;
const otpRequestHits = new Map(); // ip -> [timestamps]

const otpRequestRateLimit = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (otpRequestHits.get(ip) || []).filter((t) => now - t < OTP_REQUEST_WINDOW_MS);
  if (hits.length >= OTP_REQUEST_MAX_PER_WINDOW) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
  }
  hits.push(now);
  otpRequestHits.set(ip, hits);
  if (otpRequestHits.size > 5000) {
    for (const [key, timestamps] of otpRequestHits) {
      if (timestamps.every((t) => now - t >= OTP_REQUEST_WINDOW_MS)) otpRequestHits.delete(key);
    }
  }
  next();
};

// ============================================
// REQUEST A SHARE ACCESS CODE
// ============================================
// Mirrors emailRoutes.js's /request-account-otp (same code generation,
// hashing, cooldown, and email shape) but fully anonymous: the viewer
// following a shared link has no ICAN account or session at all. The
// response is deliberately identical whether or not the email is on the
// share's allow-list, and whether or not the token/share is even valid,
// so this endpoint can't be used to enumerate which addresses something
// was shared with.
//
// Shared by both /request-otp (single report — cmms_report_shares, see
// CMMS_REPORT_SHARING_SYSTEM.sql) and /request-export-otp (a department-
// scoped "Written Reports" export — cmms_report_export_shares, see
// CMMS_REPORT_EXPORT_SHARING.sql); only the table names differ.
const buildOtpRequestHandler = ({ sharesTable, otpsTable, accessLogTable, subject, intro }) => async (req, res) => {
  const genericResponse = { success: true, message: 'If that email has access, a verification code has been sent.' };

  try {
    if (!adminSupabase) {
      return res.status(500).json({ success: false, message: 'Server is missing Supabase configuration.' });
    }

    const token = (req.body?.token || '').trim();
    const email = (req.body?.email || '').trim().toLowerCase();

    if (!token || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }

    const { data: share } = await adminSupabase
      .from(sharesTable)
      .select('id, visibility, allowed_emails, revoked_at, expires_at')
      .eq('token', token)
      .maybeSingle();

    const isEligible =
      share &&
      share.visibility === 'restricted' &&
      !share.revoked_at &&
      (!share.expires_at || new Date(share.expires_at) > new Date()) &&
      Array.isArray(share.allowed_emails) &&
      share.allowed_emails.includes(email);

    if (!isEligible) {
      return res.status(200).json(genericResponse);
    }

    // Cooldown: don't spam a fresh code if one is still live for this
    // share + email.
    const { data: recent } = await adminSupabase
      .from(otpsTable)
      .select('id, created_at')
      .eq('share_id', share.id)
      .eq('email', email)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60 * 1000) {
      return res.status(200).json(genericResponse);
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await adminSupabase
      .from(otpsTable)
      .insert([{ share_id: share.id, email, code_hash: codeHash, expires_at: expiresAt }]);

    if (insertError) {
      console.error(`❌ Error creating OTP in ${otpsTable}:`, insertError);
      return res.status(200).json(genericResponse);
    }

    await adminSupabase
      .from(accessLogTable)
      .insert([{ share_id: share.id, viewer_email: email, outcome: 'viewed', ip_address: req.ip || null }])
      .then(() => {})
      .catch(() => {});

    const msg = {
      to: email,
      from: fromEmail,
      subject,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #166534 0%, #0f5c52 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1>🔐 Access Code</h1>
              </div>
              <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>${intro}</p>
                <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; color: #166534; margin: 20px 0;">${code}</p>
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 15px 0; border-radius: 4px;">
                  ⚠️ This code expires in 10 minutes. If you didn't request this, ignore this email.
                </div>
                <p style="font-size: 12px; color: #666;">Support: ${supportEmail}</p>
              </div>
            </div>
          </body>
        </html>
      `
    };

    await sendEmail(msg);
    console.log('✅ Report share OTP sent to:', email);

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('❌ Error requesting report share OTP:', error);
    // Still generic — an outside viewer gets no signal either way.
    return res.status(200).json(genericResponse);
  }
};

router.post('/request-otp', otpRequestRateLimit, buildOtpRequestHandler({
  sharesTable: 'cmms_report_shares',
  otpsTable: 'cmms_report_share_otps',
  accessLogTable: 'cmms_report_share_access_log',
  subject: '🔐 Your IcanEra report access code',
  intro: 'Enter this code to view the shared CMMS report:'
}));

router.post('/request-export-otp', otpRequestRateLimit, buildOtpRequestHandler({
  sharesTable: 'cmms_report_export_shares',
  otpsTable: 'cmms_report_export_share_otps',
  accessLogTable: 'cmms_report_export_share_access_log',
  subject: '🔐 Your IcanEra written reports access code',
  intro: 'Enter this code to view the shared written reports:'
}));

export default router;
