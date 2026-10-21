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

## The same assistant answers first in the app's Support chat

The "IcanEra Support" tab of the floating chat inside the IcanEra app is a real thread between a customer and the team (the team
replies from the Support Console). The assistant now answers first in that thread too, from the same knowledge:

- After the customer sends a message the app calls `POST /api/business-chat` with `{ supportConversationId }`. The server
  (`api/_lib/supportChat.js`) reads the thread, answers, and writes the answer into it as a team-side message from **"IcanEra
  Assistant"**. The customer sees it labelled "Assistant · AI" (with a typing indicator while it writes) and the team sees it in the
  Support Console in its own colour, labelled "AI assistant".
- **The team still sees every thread.** The customer's message already marks the thread unread for the team; the assistant's reply
  leaves it that way. When the assistant cannot settle something (an account problem, money, a complaint) it says it has passed
  it to the team.
- **It never talks over a person.** If a team member wrote in the last 15 minutes it stays silent. Automatic notices (the franchise
  code message, sent as "IcanEra Franchise Team") are not a person: a customer who replies to one is answered. Add any new automatic
  sender to `NOTICE_SENDER_NAMES` in `supportChat.js`. It never answers a message that
  is already answered, it ignores "thanks" and "ok", and it is capped at 12 replies per thread per hour. A voice note or a photo
  without words gets a short "I can't play voice notes, the team has it" and no AI call.
- **Works without AI** (no key, or the provider is down) from the knowledge alone; anything it does not cover goes to the team.
- Only the IcanEra app's own support threads (`origin_app = 'ican'`, `kind = 'support'`). The other apps keep their own inboxes in the
  same tables and are untouched.
- No new Vercel function: it is served by `api/business-chat.js` (the Hobby plan allows 12 and `api/` is at the limit).
- No database change. To switch it off, remove the `askAssistantToReply(...)` call in `ChatWidget.jsx`.

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
validation, prompt, fallback, and the whole path through `answerVisitor` with Supabase and the AI stubbed) and
`supportChat.test.js` (when the assistant answers and when it keeps out, what it is given, what it writes, end to end against an
in-memory copy of the chat tables).
