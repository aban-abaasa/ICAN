# "Ask us" answer memory: the assistant remembers what it has answered

The assistant in the **Ask us** bubble on a business website now remembers its answers. The first visitor to ask
"what time do you open?" gets the AI's answer; the next visitor who asks nearly the same thing ("opening hours please")
gets the remembered answer at once, with no AI call. Visitors see a small **⚡ Instant answer** label and can tap 👍 / 👎.

## Turn it on (two steps)

1. Supabase → SQL editor → paste **`BUSINESS_CHAT_MEMORY_PASTE_INTO_SUPABASE.sql`** → Run.
   (Same file as `supabase/migrations/20261122100000_business_chat_memory.sql`. Safe to run twice.)
2. Vercel → the project's environment variables: make sure **`SUPABASE_SERVICE_ROLE_KEY`** is set (the chain and report
   endpoints already use it). Memory is read and written only with that key, so nobody can plant an answer with the public key.

The website code is deployed as usual. **Until both steps are done, nothing breaks**: the assistant simply asks the AI every time.

## What is, and is not, remembered

| Rule | Why |
|---|---|
| Only real AI answers to **standalone** questions. | A fallback, a "the team will follow up" answer or a question back to the visitor is never stored. |
| Never a question with personal details (phone, email, link, "my order…") or one that leans on an earlier message ("how much is it?"). | Answers are shown to other visitors, and "it" means nothing without the earlier message. |
| A question is the same only if its **words and numbers** match (synonyms, word order and filler are ignored). | "Price for 5 people" never gets the answer for 50; "shoes" never gets "shirts". |
| Answers are tied to the business's public facts (hours, prices, jobs, news). Change any of them and old answers stop being served. They also expire after 14 days. | An answer must never be out of date. |
| Two 👎 votes (and more than 👍 votes) **mute** an answer. | Visitors correct the assistant for you. |
| The GODMINDERA family site is excluded. | Its answers depend on the app and on live prices. |

## The team stays in charge

**CMMS → Posts & Jobs → Inquiries → Learned answers** (anyone who can already handle inquiries):

- **Edit** an answer to put it in your own words. It is then **pinned**: always served, never expires, can't be muted by votes.
- **Mute** a wrong answer (the AI answers fresh instead), **Unmute** it, **Pin** / **Unpin**, or **Delete** it.
- **Teach an answer**: type a question and the answer to give. Visitors who ask the same thing in other words get it.
- See how many times each answer was served instantly, and its 👍 / 👎 votes.

A business keeps at most 300 learned answers (the most-used stay); pinned team answers are never pruned.

## Check it worked

Ask your page's assistant a question such as "what are your opening hours?", then ask "opening hours please" in a new chat.
The second answer says **⚡ Instant answer**. Or in the SQL editor:

```sql
select question, status, hits from public.business_chat_memory order by hits desc limit 20;
```
