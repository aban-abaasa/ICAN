# Book a service right on the business website

On a business website's **Market** (or **Services**) tab, a service that the business has opened for booking now shows a
**Book now** button. It opens a booking form *inside the service's own card* (no pop-up, no leaving the page):

1. **When**: a day strip with time slots, or a date and "how many" for tickets, or check-in / check-out for rooms. A full time
   is badged **Full** but can still be requested; the business confirms by chat.
2. **Your details**: name, phone, and **the business's own intake questions** for that service (text, choices, multiple choices,
   checkbox, date, file upload...), then **Request**.

**Ask us** stays on every service as an optional way to talk first (AI first, then the team), and the form has a
"Rather talk first? Ask us" link. A service that is not bookable looks and works exactly as before.

This reuses the booking system built in **digital-city-era**, which runs on the same Supabase database as this app: bookable
products (`products.is_bookable`, `booking_type`), live availability (`fn_get_available_slots`), the business's booking forms
(`service_booking_forms`) and the booking itself (`fn_create_service_booking`, which also opens the booking chat thread).

## Turn it on (one step)

1. Supabase → SQL editor → paste **`SITE_SERVICE_BOOKING_PASTE_INTO_SUPABASE.sql`** → Run.
   (Same file as `supabase/migrations/20261123100000_site_products_bookable.sql`. Safe to run twice.)

The website code is deployed as usual. **Until the SQL has run, nothing breaks**: no service shows "Book now", exactly as today.
The SQL only makes the website's product list say which services are bookable, and it works whether or not the booking tables exist.

## Needs, in the same database (from digital-city-era `backend/database/migrations/`)

`ADD_SERVICE_BOOKINGS.sql`, `ADD_SERVICE_BOOKING_TYPES.sql`, `ADD_SERVICE_BOOKING_HOUR_BLOCKS.sql`, `ADD_SERVICE_BOOKING_FORMS.sql`,
`ADD_SERVICE_BOOKING_FORM_MULTISELECT.sql`, `ADD_SERVICE_BOOKING_ALWAYS_BOOKABLE.sql`, `ADD_SERVICE_BOOKING_DEFAULT_AVAILABILITY.sql`,
`ADD_SERVICE_BOOKING_INTAKE_HARDENING.sql`. The app also works with a database that has not got the last one (the retry-safe
`idempotency_key`): it then sends the request without it.

Check what is bookable:

```sql
select name, booking_type, is_bookable from public.products where is_bookable order by name;
```

A business opens a service for booking, sets its opening hours and builds its booking form in the digital-city-era admin
(Services > availability and Booking forms). Nothing about that changes here.

## Who can do what

| | |
|---|---|
| See times and the business's questions | Anyone, no account (public reads) |
| Send the request, attach a file | A signed-in visitor: the database function refuses everyone else. Signed out, the button says **Sign in to send your request**, opens the sign-in, and **keeps everything already typed**. |
| Confirm, decline or reschedule | The business, in digital-city-era's Bookings screen, as today |

Bookings made here carry `origin_app = 'ican'`.
