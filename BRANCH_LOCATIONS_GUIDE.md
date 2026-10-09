# Branch & store locations on a map

Business Administration → **Branches & ownership** now shows where every branch is and lets an
administrator place it on a map. The same pin reaches the riders.

## Deploy order (SQL first, then the frontend)

1. `backend/BUSINESS_BRANCH_LOCATIONS.sql` (needs `BUSINESS_OWNERSHIP_TREE_CMMS_FEED.sql`; copy in `frontend/backend/`).
   Idempotent. Adds location columns to `business_profiles` and these functions:
   `fn_business_set_location`, `fn_business_branch_locations`, `fn_supermarket_set_location`, `fn_supermarket_get_location`.
2. For riders to see a store, `supermarkets` needs coordinates: run mybodaguy's `ADD_SUPERMARKET_GEOLOCATION.sql`.
   Without it the branch still saves; the app says the linked store could not take the pin yet.
3. Deploy the frontend (adds the `leaflet` dependency, so run `npm install` in `frontend/`).

## How it behaves

* **Search a specific place.** Type a shop, street or landmark; pick the exact match from the list. Or tap the map,
  drag the pin, use the device location, or type latitude/longitude. Nothing needs a GPS or a particular computer.
* **Every branch has its own pin.** Each node of the tree has *Set location / Update location*.
  A head-office administrator can place any branch below it; a branch administrator can place their own.
* **Directions for riders** (up to 600 characters, e.g. "behind the Shell station, blue gate") are stored with the pin,
  so someone with no map data can still find the place.
* **One pin, everywhere.** When a branch is linked to a supermarket (CMMS → Supermarket link), saving the branch also writes
  the pin to that supermarket, which is what BodaGoEra's nearest-store search and delivery pickup read.
  The store side works the other way too: `fn_supermarket_set_location` (used by digital-city-era's
  *Admin store settings → Delivery pickup point*, and by the *Store location* row in the CMMS Supermarket link)
  updates the supermarket **and** the branch business profile(s) linked to it.
* **Who may set a location:** an administrator of the business or of any business above it in the tree (branches);
  the owner or an active manager of the supermarket (stores). Nobody else, and signed-out users never.

## Customer map (BodaGoEra)

The customer map no longer shows one generic "denied or unavailable" error. It tries the network position when there is
no GPS fix, tells the person *why* it failed (blocked, needs https, timed out), remembers the last known area to open on,
and shows live place suggestions as they type.
