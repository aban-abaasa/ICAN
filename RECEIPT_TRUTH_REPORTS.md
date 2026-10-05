# Receipt truth in reports

Every transaction in ICAN already has a receipt: a photo, a receipt number, or the
system receipt generated from the ledger row. Reports now state what those receipts
say, instead of leaving it to whoever reads the file.

Code: `frontend/src/utils/receiptTruth.js` (pure, no network). Tests:
`frontend/tests/receiptTruth.test.js` (`npm test` in `frontend/`).

## Evidence grades (per transaction)

| Grade  | Meaning                         |
| ------ | ------------------------------- |
| Gold   | receipt photo **and** receipt no. |
| Silver | receipt photo **or** receipt no.  |
| Bronze | system receipt only              |

"Backed" means gold or silver. Coverage is reported two ways: by number of entries
and by money (so one large unreceipted purchase is not hidden by many small receipted ones).

Report rating: **A** ≥ 90% of value backed, **B** ≥ 70%, **C** ≥ 40%, **D** below.
An A drops to B while any entry needs a closer look.

## Flags

| Flag                | Raised when                                                                 | Counts as "needs a closer look" |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| Receipt reused      | the same receipt photo, or the same receipt no. (3+ characters, ignoring case and punctuation), is on 2+ different entries | yes |
| Large, no receipt   | bronze entry of 500,000 UGX or more (UGX entries only)                       | yes |
| Proof added late    | proof attached more than 7 days after the entry date                         | no — context only (backdated entries are a supported feature) |

Entries recorded by the platform itself (IcanEra wallet, CMMS) are not flagged as
"large, no receipt": they have their own two-sided ledger record and no place to
attach a photo. Thresholds live in `DEFAULT_TRUTH_OPTIONS`.

## Seals

* **Entry seal** — SHA-256 of this JSON array:
  `[1, receiptNumber, createdAtISO, "income"|"expense", abs(amount), currency, description.trim(), grade, receiptRef, receiptImageRef]`
  (see `getReceiptCanonical`). It is locale-independent, so it is the same on every device.
* **Report seal** — SHA-256 of the entry seals sorted and joined with `\n`
  (see `computeSealRoot`). Row order never matters.

If an amount, date, description, photo or receipt number is changed, or an entry is
added or removed, the report seal changes. **Keep the seal with your copy** — the saved
report stores it, and exports print it, so two copies can be compared.

A seal shows the records are *unchanged*. It does not prove a receipt is *genuine*, and
anyone who edits a file can also recompute a new seal for it; it is tamper-evident only
against a copy of the seal kept somewhere else.

## Where it shows up

* **Transaction list** — the receipt strip (tier bar, coverage, rating, flags, seal) and a
  Gold/Silver chip plus ⚠️ on each row; the receipt screen shows the entry's tier.
* **Transaction downloads (PDF / Excel / CSV / share)** — Receipt Truth panel and
  per-page seal in the PDF; `Evidence`, `Truth Flags`, `Receipt Seal` columns in
  Excel/CSV (plus `Report Seal` in CSV); a "Receipt Truth" block on the Excel
  "Report Info" sheet; the statement in the email / WhatsApp text.
* **Generated reports (tax return, balance sheet, income statement, compliance)** —
  a Receipt Truth card in the preview, a dedicated section in the PDF, `receiptTruth.*`
  fields in CSV/Excel/JSON/email. Tax returns also show how much of the claimed
  deductions has a receipt behind it.
* **Automatic weekly/monthly reports and daily archives** — saved with `receiptTruth`;
  each archived entry carries its own `receipt` stamp (number, grade, flags, seal).

Saved reports keep this inside the existing `financial_reports.data` JSON, so no
database migration is needed. Reports saved before this change simply have no
`receiptTruth` and show no card.

## Not covered

CMMS record exports, the Pitchin day book, and re-importing an exported file (imports
create new entries and do not carry receipts over).
