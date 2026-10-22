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

Roll back with `supabase/rollback/20261110_rollback_restricted_zone_access.sql` (keeps the visit history).

## Using it

* **Organisation:** Restricted zones → *Create your first zone* → choose *Must pay to enter* and set a fee per vehicle type
  (0 = free for that type, unticked = refused), cash yes/no, optional time limit and overstay fee. Then
  *Approved vehicles* → search by plate or card number (or scan the card into the box) → *Approve*, optionally with an end
  date or allowed hours.
* **Gate:** open *Gate desk*, put the cursor in the box and scan the rider's card with a USB/Bluetooth scanner (or paste the link
  from any phone QR app). *Auto* checks a vehicle that is inside out and any other in; use *Check in* / *Check out* for
  separate lanes. Optionally type the plate you see: a mismatch with the card is flagged.
* **Customer:** nothing to do: the booking screen warns them, and the fee shows on their ride. (A zone that is not on the map cannot
  warn anyone, so riders would pay it alone: the editor and the zone page say so.)
* **Rider:** BodaGoEra → **Gate Passes**. A fee request appears there (and as a phone alert); approve it with the PIN.
  The tab also lists the zones that approved the rider's vehicles and where they are inside right now.

## Tests

* Database (real migration on a throwaway Postgres): `supabase/tests/zone_access/run.sh`
* UI ↔ database contract (function and argument names): `cd frontend && npm test`

## Known limits

* The transaction PIN is checked in the app before the payment call, exactly like paying for the rider ID card.
* A customer who was not warned is still charged (the rider's fee is passed on to them). They are notified at once; there is no
  dispute screen yet, so a wrongly charged fee is refunded by support.
* The fee is added beside the fare, not inside it: the ride's own fare, commissions and receipts are untouched. It shows as its own
  line on the ride screens and in the wallet history.
* Ride matching is by the pickup and drop-off coordinates and the zone's circle; a zone that is not on the map cannot warn customers.
* The developer panel does not list the new rate; change it with the SQL above.
* In *Auto* mode a vehicle that left without being scanned out is seen as "inside" and the next scan checks it out; use
  separate *Check in* / *Check out* lanes where that can happen.
