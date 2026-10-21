# The "Ask us" assistant on the GODMINDERA website: support for every IcanEra app

On `icanera.space/godmindera-organisation-u-ltd` the "Ask us" bubble is the front desk for the whole family: **IcanEra, SupermartKera,
BodaGoEra and AgriBone**. On every other business website it stays the ordinary assistant, unchanged.

## What it does

- **Knows the apps.** 88 curated answers written from each app's own code and copy (`frontend/api/_lib/knowledge/*.js`): signing in,
  wallet and PIN, fees, QR payments, instalments, business tools, shopping and the till, rides and journeys, farm produce offers.
- **Picks what matters.** Each question reaches the few topics that fit it (plus the essentials of every app, so a question in
  another language still has something to stand on). The AI replies in the visitor's language.
- **Tells you which app it is about.** Answers carry an "About <app>" tag; if the app is unclear it asks one short question.
- **Quotes live facts**, read when the question is asked and never written into the knowledge: the IcanEra coin price and BodaGoEra's
  current platform charge. (Both are public data.)
- **Only vetted links.** The AI names a link id; the server turns it into an address from a fixed list (`LINKS` in
  `familyKnowledge.js`). It can never send a visitor anywhere else.
- **Safe.** It never asks for or repeats a PIN, password or code, gives no investment advice, cannot see anyone's account, and sends
  account problems to the team.
- **Hands over to a person with context.** "Message the team" asks which app it is about; the team sees `[BodaGoEra] ...` at the
  start of the message in CMMS > Announcements & Jobs > Inquiries.
- **Still works without AI.** With no `OPENAI_API_KEY` / `GEMINI_API_KEY`, or if the provider is down, it answers from the same
  knowledge by keyword (and says which app, with links).

## Helping people from inside the other apps

Link to `https://icanera.space/godmindera-organisation-u-ltd?ask=bodagoera` (or `supermartkera`, `agribone`, `icanera`; plain `?ask`
opens it without an app). The chat opens by itself, already about that app.

## Keeping it right

Add or change answers in `frontend/api/_lib/knowledge/`. Rules (also checked by `tests/familySupport.test.js`):

1. Write only what a customer could verify in the app. If unsure, leave it out: the assistant then hands the question to the team.
2. No email addresses, phone numbers or placeholders (contact details come from this company's public profile), and no numbers the
   platform can change.
3. Keep `answer` short and customer-ready: it is also what the no-AI fallback says.
4. New links go in `LINKS`. AgriBone has no link because its public address is not confirmed in its code; set `APPS[agribone].url`
   and add a link once it is.

Left out on purpose because the apps themselves do not deliver them yet: staking, wishlists, loyalty points and cashback,
in-app ordering in AgriBone, ride star ratings, an SOS button.

## Tests

`cd frontend && npm test` runs `familySupport.test.js` (knowledge rules, 25 realistic questions reaching the right topic, output
validation, prompt, fallback, and the whole path through `answerVisitor` with Supabase and the AI stubbed).
