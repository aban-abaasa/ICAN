# Report Automation Setup

This project now includes server-side background report automation via Vercel cron jobs.

## Endpoint

- GET /api/report-automation
- Modes:
  - /api/report-automation?mode=daily
  - /api/report-automation?mode=weekly
  - /api/report-automation?mode=monthly

## What It Does

- Daily:
  - Archives prior-day transaction item lists into financial reports.
  - Archive reports are saved as income-statement with tags: auto, daily-archive, YYYY-MM-DD.
- Weekly:
  - Generates weekly income statement summaries.
- Monthly:
  - Generates monthly income statement summaries.

## Required Environment Variables

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- REPORT_AUTOMATION_SECRET (optional for manual trigger protection)

## Notes

- Vercel cron requests are accepted using x-vercel-cron header.
- If REPORT_AUTOMATION_SECRET is set, non-cron manual calls must pass:
  - query: ?secret=YOUR_SECRET
  - or header: x-automation-secret: YOUR_SECRET
