/**
 * The classic IcanEra look shared by the two public payment pages (/p/<code> and /r/<code>):
 * ivory paper, gold rules, an indigo header band, serif amounts — the same palette as the IcanEra
 * receipts. Follows the visitor's light/dark preference (these pages sit outside the app's
 * ThemeProvider). Phone first: 44px+ tap targets, 16px inputs (no iOS zoom), safe-area padding;
 * from 768px the card widens and fields sit side by side.
 *
 * Everything lives under .ptx and uses :where() resets so single-class rules always win.
 */
export const CLASSIC_PAY_CSS = `
.ptx {
  --bg:#f7f3e8; --surface:#fffdf8; --alt:#f4eedb; --text:#25253f; --muted:#5b5b78; --faint:#8a8aa3;
  --border:#e6d8b2; --gold:#c4a052; --gold-ink:#7a5f17;
  --indigo:#312e81; --indigo-hover:#272566; --on-indigo:#fffdf8; --ring:rgba(196,160,82,.45);
  --green:#166534; --green-soft:#e3f3e8; --amber-soft:#faf1da; --amber-ink:#8a5a12;
  --red:#8a1f2b; --red-soft:#f8e7e8; --shadow:0 1px 2px rgba(49,46,129,.06), 0 8px 24px rgba(49,46,129,.08);
  background:var(--bg); color:var(--text); min-height:100vh; min-height:100dvh;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-text-size-adjust:100%;
}
@media (prefers-color-scheme: dark) {
  .ptx {
    --bg:#0d0e1d; --surface:#161730; --alt:#1e2042; --text:#f3f0e4; --muted:#bdbbd6; --faint:#8a88ad;
    --border:#34365f; --gold:#e6c877; --gold-ink:#f0d58a;
    --indigo:#5b57e8; --indigo-hover:#7370f0; --on-indigo:#ffffff; --ring:rgba(230,200,119,.4);
    --green:#4ade80; --green-soft:#12301f; --amber-soft:#3a2f13; --amber-ink:#f4c86a;
    --red:#f0919b; --red-soft:#3a1a1e; --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
  }
}
:where(.ptx) *, :where(.ptx) *::before, :where(.ptx) *::after { box-sizing:border-box; }
:where(.ptx) h1, :where(.ptx) h2, :where(.ptx) p { margin:0; }
:where(.ptx) button { font:inherit; border:0; background:none; color:inherit; cursor:pointer; }
:where(.ptx) a { text-decoration:none; }

.ptx-wrap { width:100%; max-width:520px; margin:0 auto; padding:16px 14px calc(28px + env(safe-area-inset-bottom)); }
.ptx-card { background:var(--surface); border:1px solid var(--border); border-radius:18px; box-shadow:var(--shadow); overflow:hidden; }
.ptx-section { background:var(--surface); border:1px solid var(--border); border-radius:18px; box-shadow:var(--shadow); padding:18px; margin-top:14px; }

/* indigo header band with a gold rule: the classic receipt head */
.ptx-head { background:var(--indigo); color:var(--on-indigo); padding:20px 18px 18px; text-align:center; border-bottom:4px solid var(--gold); }
.ptx-eyebrow { font-size:11px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--gold); }
.ptx-title { font-family:Georgia,'Times New Roman',serif; font-size:22px; font-weight:700; line-height:1.2; margin-top:6px; }
.ptx-sub { font-size:14px; opacity:.85; margin-top:6px; line-height:1.45; }
.ptx-amount { font-family:Georgia,'Times New Roman',serif; font-size:36px; font-weight:700; letter-spacing:-.01em; margin-top:10px; line-height:1.1; }
.ptx-body { padding:6px 18px 18px; }

.ptx-alt { background:var(--alt); }
.ptx-muted { color:var(--muted); } .ptx-faint { color:var(--faint); }
.ptx-border { border-color:var(--border); }
.ptx-rule { border:0; border-top:1px solid var(--border); margin:0; }
.ptx-h2 { font-family:Georgia,'Times New Roman',serif; font-size:18px; font-weight:700; }
.ptx-note { font-size:12px; line-height:1.5; color:var(--faint); }

.ptx-row { display:flex; justify-content:space-between; gap:16px; padding:11px 0; font-size:14px; border-bottom:1px dotted var(--border); }
.ptx-row:last-child { border-bottom:0; }
.ptx-row > span:first-child { color:var(--faint); flex-shrink:0; }
.ptx-row > span:last-child { text-align:right; font-weight:600; overflow-wrap:anywhere; max-width:64%; }

.ptx-input { width:100%; min-height:48px; background:var(--surface); color:var(--text); border:1px solid var(--border);
  border-radius:12px; padding:11px 13px; font-size:16px; line-height:1.3; }
.ptx-input::placeholder { color:var(--faint); }
.ptx-input:focus { outline:none; border-color:var(--gold); box-shadow:0 0 0 4px var(--ring); }
.ptx-field-row { display:flex; gap:8px; align-items:center; }

.ptx-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; min-height:48px; border-radius:12px;
  padding:11px 16px; font-weight:700; font-size:15px; line-height:1.25; text-align:center; transition:background .15s, transform .05s; }
.ptx-btn:active:not(:disabled) { transform:scale(.985); }
.ptx-btn:disabled { opacity:.55; cursor:not-allowed; }
.ptx-btn:focus-visible, .ptx-ghost:focus-visible, .ptx-link:focus-visible { outline:3px solid var(--ring); outline-offset:2px; }
.ptx-primary { background:var(--indigo); color:var(--on-indigo); box-shadow:inset 0 -3px 0 rgba(196,160,82,.9); }
.ptx-primary:hover:not(:disabled) { background:var(--indigo-hover); }
.ptx-secondary { background:var(--surface); color:var(--text); border:1px solid var(--gold); }
.ptx-secondary:hover:not(:disabled) { background:var(--alt); }
.ptx-ghost { display:inline-flex; align-items:center; gap:6px; min-height:44px; color:var(--indigo); font-weight:700; font-size:14px; }
@media (prefers-color-scheme: dark) { .ptx-ghost { color:var(--gold); } }
.ptx-link { color:var(--indigo); font-weight:700; }
@media (prefers-color-scheme: dark) { .ptx-link { color:var(--gold); } }
.ptx-iconbtn { display:inline-flex; align-items:center; justify-content:center; min-width:44px; min-height:44px; border-radius:10px; color:var(--faint); }

.ptx-chip { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:5px 13px; font-size:12px; font-weight:700; }
.ptx-chip-green { background:var(--green-soft); color:var(--green); }
.ptx-chip-amber { background:var(--amber-soft); color:var(--amber-ink); }
.ptx-chip-neutral { background:var(--alt); color:var(--muted); }
.ptx-err { color:var(--red); background:var(--red-soft); border-radius:10px; padding:10px 12px; font-size:13px; line-height:1.45; }
.ptx-callout { border-radius:14px; padding:14px 16px; background:var(--alt); border:1px solid var(--border); }
.ptx-callout-ok { border-color:var(--green); background:var(--green-soft); }
.ptx-callout-wait { border-color:var(--gold); background:var(--amber-soft); }
.ptx-callout-bad { border-color:var(--red); background:var(--red-soft); }

.ptx-divider { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--faint); text-transform:uppercase; letter-spacing:.12em; }
.ptx-divider::before, .ptx-divider::after { content:''; flex:1; border-top:1px solid var(--border); }
.ptx-item { background:var(--alt); border:1px solid var(--border); border-radius:14px; padding:12px; display:grid; gap:8px; }
.ptx-total { display:flex; justify-content:space-between; align-items:baseline; padding-top:12px; border-top:2px solid var(--gold); }
.ptx-total strong { font-family:Georgia,'Times New Roman',serif; font-size:26px; }
.ptx-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.ptx-footer { text-align:center; font-size:11px; color:var(--faint); margin-top:18px; letter-spacing:.04em; }
.ptx-stack { display:grid; gap:12px; }
.ptx-stack-tight { display:grid; gap:8px; }

@media (min-width:768px) {
  .ptx-wrap { max-width:600px; padding-top:40px; }
  .ptx-head { padding:26px 28px 22px; }
  .ptx-title { font-size:26px; }
  .ptx-amount { font-size:44px; }
  .ptx-body { padding:10px 28px 26px; }
  .ptx-section { padding:24px 28px; }
  .ptx-btn { min-height:50px; }
}
@media (prefers-reduced-motion: reduce) { .ptx-btn { transition:none; } }

@media print {
  .ptx { background:#fff !important; color:#000 !important; --surface:#fff; --alt:#f6f3ea; --text:#000; --muted:#333; --faint:#555; --border:#bbb; --indigo:#312e81; }
  .ptx-noprint { display:none !important; }
  .ptx-card, .ptx-section { box-shadow:none; border-radius:0; }
  .ptx-head { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ptx-wrap { max-width:none; padding:0; }
}
`;
