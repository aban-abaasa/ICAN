# Restricted zones: approved vehicles free, everyone else pays, cleared on the way out

An organisation that controls an area (estate, campus, hospital, market, port…) registers on IcanEra
(business account + CMMS) and manages who may enter from **CMMS → Transport → Restricted zones**.
Every kind of vehicle works (boda, bicycle, tuk-tuk, car, van, truck): the gate reads the vehicle's
**BodaGoEra rider ID card QR**, which is a public link, so no special hardware is needed.

## How it works

| Who arrives | Entry | On the way out |
|---|---|---|
| **Approved** vehicle (on the zone's list, within its dates/hours) | In, **free**. No entry fee, no overstay fee. | Scan again: cleared. |
| **Not approved**, zone sells entry | The gate asks the rider for the fee for their vehicle type. The rider approves it in BodaGoEra with their PIN (or the gate takes cash, if the zone allows it). Only then is the vehicle in. | Must be checked in and have **paid everything** (entry + any overstay), otherwise it is held. |
| **Not approved**, zone sells no entry | Refused. | n/a |
| Card cancelled, unpaid, expired, or rider suspended | Refused, even if approved. Nothing about the rider is shown. | n/a |

A suspended, expired or out-of-hours approval counts as "not approved", so that vehicle pays.
The QR on a card is public, so **anyone can scan it, but only signed-in staff with the gate permission
can check a vehicle in**, and a fee is charged only when the rider approves it in their own app.

## When a customer is on the ride, the customer pays

A rider carrying a customer is never left to face the fee alone. Put the zone **on the map** (latitude, longitude, radius: stand at
the gate and press *Use my location* in the zone editor) and:

1. **Before booking**, the BodaGoEra booking screen tells the customer: *"This place charges an entry fee: UGX 2,000, added to your trip.
   You pay it, not your rider. Free if your rider is approved there."* It appears only when the trip really starts or ends in such a
   place, shows the fee for the vehicle chosen (a range if none is chosen yet), and says how it will be charged (wallet / cash).
   The moment the ride is booked, the warning is recorded against it.
2. **At the gate**, when that rider arrives on that live ride (picking up or dropping off inside the zone):

| Situation | Who pays | How |
|---|---|---|
| Rider is **approved** at the zone | nobody | free |
| Customer was **warned**, wallet ride | the **customer** | charged to their wallet at the gate; the rider pays nothing |
| Customer was warned, cash ride (or short wallet) | the **customer** | pays the gate in cash, if the zone takes cash |
| Customer was **not warned** (or the fee rose since) | the **customer**, passed on | the rider pays at the gate so nothing is held up, then the **whole fee is taken from the customer's wallet and paid back to the rider** at once; on a cash ride the rider collects it and both screens say so |
| No live ride to this zone | the **rider**, alone | as before |

One entry per ride per zone: a second entry on the same ride is free. Overstay is always the rider's. The customer is notified when
a fee is added to their ride, and both the customer's and the rider's ride screens show it.

## The gate runs from the rider's card page (no gate desk needed)

The QR on a rider's ID card opens the public page `https://bodagoera.icanera.space/rider-card/<code>`. Gate staff scan it with an
ordinary phone camera, **sign in once** (Google, or an e-mail link; the phone stays signed in), and the page itself runs the gate:

| What the page shows staff | One tap |
|---|---|
| **Approved staff · enters free** (or *no fee for this vehicle*, *day pass already paid*, *ride already paid*) | Check in · free |
| **Not approved · entry fee UGX 2,000**, and who pays: the rider alone, the customer on the ride (they were warned), or the rider now and passed on to the customer | Check in · ask for UGX 2,000. The page then waits and updates **by itself** the moment the rider approves it in BodaGoEra (or the gate takes cash, if the zone allows it, or withdraws the request) |
| **Inside · check out** (what is still due, if anything) | Check out: clears only when everything is paid; an overstay is paid the same way |
| **Not allowed in**, with the reason (card cancelled / unpaid / expired, rider suspended, vehicle type not accepted, zone closed…) | *Log this refusal* |

The page stays public: anyone else sees exactly the check they always saw, plus a quiet *Gate staff? Sign in*. A signed-in customer or
rider sees one muted line ("no gate access on this account"). Only a person whose CMMS role has **Transport → gate** (or the business
owner / a CMMS administrator) gets the panel, and the database checks that on every call, not the page. Staff who work for several
businesses choose the zone; the choice and the gate name are remembered on that phone. The typed plate is compared with the card **before**
anything happens, so someone else's card is flagged first. After a check-in or check-out the buttons go away so a second tap cannot undo it.

Two read-only functions make this possible (`20261111100000_zone_gate_from_card_page.sql`): `mbg_my_gate_zones()` lists the zones the
signed-in person may run, and `mbg_zone_gate_peek(zone, code)` previews a scan without writing anything. A test runs every preview
against the real scan so the two cannot drift apart. The CMMS gate desk still works exactly as before.

## A rider who goes in by force keeps it on his record, publicly

A restricted area can only ask. A vehicle that drives past the gate without checking in or paying, or that is let in and leaves
owing money, cannot be stopped by software, so it is **put on the record**, where everyone who checks that rider's card can see it.

The gate (Transport → gate, the owner, or a CMMS admin) reports it from the rider's card page, behind a small
*"It went in by force? Report it"* link (and *"It already left without paying UGX 3,000? Report it"* for a vehicle that is
inside and owes money). The page says plainly that this is public and asks for a private note. Two kinds of line:

| Kind | Meaning | Also |
|---|---|---|
| **Went in by force** | went in without checking in or paying (ignored the gate, or refused and drove on) | a fee request that was waiting is closed; a refused drive-in is logged |
| **Left without paying** | was inside, owed money (an overstay, an unpaid balance) and left without checking out | the visit is closed at once, so the vehicle is not "inside" for ever and can be checked in again |

**Who sees what.** Everyone, on the public card page: a red *Gate record* block under the verdict (*"On record: 2 times this rider went in
by force or left without paying"*) listing each line's date, area, organisation and *Settled / Not settled*. Every gate that scans that card,
in any zone, gets the same line as a **warning** (on the card page and in the CMMS gate desk). The rider is **told at once** by phone alert.
The business alone sees who recorded it, the private note and the fee that was avoided; the public never does.

**Fairness.** An approved vehicle cannot be reported for forced entry (it was let in), nor one that is checked in; a vehicle that owes nothing
cannot be reported for leaving without paying; the same report twice within 30 minutes is one line. **Settled** (the gate collected what
was owed; any gate role can mark it) stays on the record, marked settled: paying makes it right, it does not make it disappear. Only a
**manager** (Transport → assign, the owner or an admin) can **withdraw** a line that was recorded in error, with a reason; it leaves the
public record but the row is kept in the business's audit trail, and the rider is told. A rider who disputes a line asks the organisation named on it.

## IcanEra's cut: 3%

IcanEra keeps **3% of every fee a business sets** (`ican_fee_rates.zone_access_fee`). The rider always pays
exactly the published fee; the business receives 97%. Wallet payments are split in one transaction.
For cash, the business holds the money, so IcanEra's 3% is taken from the business ICAN wallet at once;
if the wallet cannot cover it, it stays *owed* on the visit and is settled automatically later
(or press **Settle now** in the zone's log). To change the rate (takes effect on the next request):

```sql
UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'zone_access_fee';
```

## Deploy

1. Make sure the earlier pieces are installed: the BodaGoEra setup (rides and customers), rider ID cards
   (`mybodaguy/backend/database/ADD_RIDER_ID_CARDS.sql` and `ADD_RIDER_CARD_EXPIRY_AND_KIN.sql`),
   `ICAN/backend/ADD_RIDE_EARNING_CREDIT_FUNCTION.sql` (pays a rider back), the fee rates (`FEE_RATES_PASTE_INTO_SUPABASE.sql`), the platform-fee business
   (`ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql`) and the CMMS schema. The migration says which one is missing.
2. Run **`RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql`** (same as `supabase/migrations/20261110100000_restricted_zone_access.sql`)
   in the Supabase SQL editor. Safe to run twice.
3. Redeploy the `wallet-push` Edge Function (it gained the `bodagoera_gate` source, so a rider's phone is alerted when a gate
   asks for a fee). Without it everything still works: the BodaGoEra screen refreshes by itself every few seconds.
4. Deploy the ICAN and BodaGoEra frontends.
5. In CMMS → Role and tool configuration give each role the **Transport** actions it needs:
   `edit` (create zones, set fees), `assign` (approve/suspend vehicles), `gate` (run the gate desk: give security staff
   `view` + `gate`), `view` (read the log). The business owner and CMMS administrators can do everything.

6. **Card page gate:** run **`ZONE_GATE_FROM_CARD_PAGE_PASTE_INTO_SUPABASE.sql`** (same as
   `supabase/migrations/20261111100000_zone_gate_from_card_page.sql`) after step 2 and deploy the BodaGoEra frontend. Safe to run twice.
   Staff sign in on the BodaGoEra site, so Google sign-in must be allowed there (it already is for shop receipt approval). If Google
   sends them back to the site root, the page returns to the card they scanned by itself.

7. **Gate record:** run **`ZONE_FORCED_ENTRY_RECORD_PASTE_INTO_SUPABASE.sql`** (same as `supabase/migrations/20261112100000_zone_forced_entry_record.sql`)
   after step 2 and deploy the BodaGoEra frontend. Safe to run twice. Without it the card page shows no record and offers no report link.

Roll back with `supabase/rollback/20261110_rollback_restricted_zone_access.sql` (keeps the visit history), only the card page's gate
with `supabase/rollback/20261111_rollback_zone_gate_from_card_page.sql` (the CMMS gate desk keeps working), or only the public record with
`supabase/rollback/20261112_rollback_zone_forced_entry_record.sql` (the records themselves are kept and come back when the migration is run again).

## Using it

* **Organisation:** Restricted zones → *Create your first zone* → choose *Must pay to enter* and set a fee per vehicle type
  (0 = free for that type, unticked = refused), cash yes/no, optional time limit and overstay fee. Then
  *Approved vehicles* → search by plate or card number (or scan the card into the box) → *Approve*, optionally with an end
  date or allowed hours.
* **Gate, from a phone:** scan the card with the phone camera, sign in the first time, tap the one big button (see above).
* **Gate, from a desk:** open *Gate desk*, put the cursor in the box and scan the rider's card with a USB/Bluetooth scanner (or paste the link
  from any phone QR app). *Auto* checks a vehicle that is inside out and any other in; use *Check in* / *Check out* for
  separate lanes. Optionally type the plate you see: a mismatch with the card is flagged.
* **Customer:** nothing to do: the booking screen warns them, and the fee shows on their ride. (A zone that is not on the map cannot
  warn anyone, so riders would pay it alone: the editor and the zone page say so.)
* **Rider:** BodaGoEra → **Gate Passes**. A fee request appears there (and as a phone alert); approve it with the PIN.
  The tab also lists the zones that approved the rider's vehicles and where they are inside right now.

## Tests

* Database (real migration on a throwaway Postgres): `supabase/tests/zone_access/run.sh`
* UI ↔ database contract (function and argument names, including the BodaGoEra card page's service): `cd frontend && npm test`

## Known limits

* The transaction PIN is checked in the app before the payment call, exactly like paying for the rider ID card.
* A customer who was not warned is still charged (the rider's fee is passed on to them). They are notified at once; there is no
  dispute screen yet, so a wrongly charged fee is refunded by support.
* The fee is added beside the fare, not inside it: the ride's own fare, commissions and receipts are untouched. It shows as its own
  line on the ride screens and in the wallet history.
* Ride matching is by the pickup and drop-off coordinates and the zone's circle; a zone that is not on the map cannot warn customers.
* The developer panel does not list the new rate; change it with the SQL above.
* A gate record is reported by a person at the gate and is not detected automatically. There is no dispute screen for the rider yet: a
  rider who thinks a line is wrong asks the organisation named on it to withdraw it. Paying the fee that was avoided is settled by the gate
  (cash, then *Mark settled*); the rider cannot pay it from the app yet.
* In *Auto* mode a vehicle that left without being scanned out is seen as "inside" and the next scan checks it out; use
  separate *Check in* / *Check out* lanes where that can happen.
