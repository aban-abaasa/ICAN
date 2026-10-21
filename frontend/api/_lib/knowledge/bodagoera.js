// BodaGoEra: rides, deliveries and journeys (bodagoera.icanera.space). Facts from the app's own code and copy.
// The platform charge is NOT written here: it is set by the platform and changes, so the assistant quotes the live value it is given.
// Left out on purpose: an SOS button (none exists), ride star ratings (not saved), cancellation fees (none found), base-fare numbers.
export const TOPICS = [
  {
    id: 'boda-overview', app: 'bodagoera', core: true, title: 'What BodaGoEra is',
    keywords: ['bodagoera', 'boda go era', 'bodago', 'boda boda', 'boda', 'ride', 'rides', 'what is bodagoera'],
    answer: 'BodaGoEra (bodagoera.icanera.space) is the transport and delivery app: book a boda, bicycle, tuktuk, car, van or truck, send deliveries from a store, plan journeys by road, air and sea, or work as a rider. It uses your IcanEra wallet and is run with stage chairpersons who lead local riders.',
    links: ['bodagoera'],
    followUps: ['How do I book a ride?', 'How do I become a rider?', 'What does a ride cost?'],
  },
  {
    id: 'boda-signin', app: 'bodagoera', title: 'Signing in to BodaGoEra',
    keywords: ['sign in', 'login', 'log in', 'register', 'sign up', 'create account', 'forgot password', 'wallet sign in', 'google'],
    answer: 'Sign up with your name, email, country and a password (at least 6 characters, then confirm the email), or continue with Google, or sign in with your IcanEra wallet account number (or phone) and your 4-6 digit PIN. "Forgot password?" emails a reset link. The same account and wallet work in IcanEra and SupermartKera, and a country is required.',
  },
  {
    id: 'boda-book', app: 'bodagoera', title: 'Booking a ride or delivery',
    keywords: ['book', 'booking', 'book a ride', 'book ride', 'request ride', 'order a boda', 'find rider', 'ride', 'boda', 'nearest rider', 'just send', 'pickup', 'drop-off', 'dropoff', 'delivery', 'send package', 'book delivery', 'van', 'truck', 'car'],
    answer: '1) Open "Book a Ride" (boda, car, van or truck) or "Delivery". 2) Choose pickup and drop-off from the suggestions. 3) Tap "Find Available Riders - Choose One" to pick a rider and see their price, or "Just Send - Nearest Available Rider". A chosen rider has 30 seconds to respond; "Just Send" tries the next rider every 10 seconds, up to 15 tries, then cancels. 4) Pay by IcanEra wallet, cash, or Company if your account is eligible, and follow the ride live on the map.',
    facts: 'Vans and trucks are priced as freight by weight and cargo class. The estimate is shown first and each driver\'s final price before you book.',
    followUps: ['What does a ride cost?', 'How do I pay?', 'Can I track my ride?'],
  },
  {
    id: 'boda-fare', app: 'bodagoera', core: true, title: 'Fares and the platform charge',
    keywords: ['fare', 'price', 'cost', 'how much', 'charge', 'platform charge', 'fee', 'commission', 'cheap', 'expensive', 'peak', 'surge', 'extra'],
    answer: 'Each vehicle type has its own rates, shown as an estimate and then as the driver\'s final price before you book. You pay the exact fare plus a platform charge on top (the current percentage is given in the live data, and it is the same for wallet and cash); the rider always receives the exact fare. There can be a peak-hour multiplier. Company-billed rides show the plain fare.',
    followUps: ['How do I pay?', 'Why did my total change?'],
  },
  {
    id: 'boda-pay', app: 'bodagoera', title: 'Paying for a ride',
    keywords: ['pay', 'payment', 'wallet', 'cash', 'company', 'charged', 'pay rider', 'switch payment', 'mobile money'],
    answer: 'For rides you can pay with your IcanEra wallet (charged automatically when the trip ends), with cash (hand the rider the full amount shown), or on Company if your account is eligible; you can switch between wallet and cash before the trip. A store delivery paid by wallet asks for your PIN first and is charged only when a rider accepts. Mobile Money is not a ride payment option in the app: it works for store purchases on the store\'s website, instalments and cash-out.',
  },
  {
    id: 'boda-track-safety', app: 'bodagoera', title: 'Tracking and safety',
    keywords: ['track', 'tracking', 'live', 'map', 'call rider', 'chat rider', 'safety', 'safe', 'sos', 'panic', 'emergency', 'security escort', 'escort', 'rider card', 'verify rider'],
    answer: 'During an active ride you see the live map and can Call, Video, Chat or Send Money to the rider; reopen it from Orders. For safety you can add a security escort (priced by the escort company) and check a rider\'s ID card by scanning its QR (bodagoera.icanera.space/rider-card/<code>): it shows Genuine, Suspended, Not activated, Cancelled or Expired, and never the rider\'s phone or email. BodaGoEra has no SOS button, so in an emergency call the local emergency services first, then tell the team.',
    handoff: true,
  },
  {
    id: 'boda-history', app: 'bodagoera', title: 'Ride history and cancelling',
    keywords: ['history', 'past rides', 'orders', 'cancel', 'cancel ride', 'cancel order', 'delete order', 'receipt'],
    answer: 'Your last 5 rides show on Overview and the last 20 under Orders. You can cancel an active order with a reason; finished orders can be removed from your list while the payment records are kept.',
  },
  {
    id: 'boda-become-rider', app: 'bodagoera', title: 'Becoming a rider',
    keywords: ['become a rider', 'become a driver', 'rider application', 'join as rider', 'driver', 'work as rider', 'plate', 'licence', 'license', 'approved', 'assign rider', 'chairperson'],
    answer: 'Two ways: 1) In the customer dashboard open "Become a Driver", choose your vehicle (motorcycle, bicycle, tuktuk, car, van or truck), enter the plate and licence number; a developer reviews every application (you see pending, approved or rejected with a reason, and can chat with the team). 2) A stage chairperson can assign you as a rider directly, and you become active at once.',
    handoff: false,
    followUps: ['How do riders get paid?', 'What is a rider ID card?'],
  },
  {
    id: 'boda-rider-work', app: 'bodagoera', title: 'Working as a rider',
    keywords: ['rider', 'online', 'offline', 'working time', 'requests', 'accept', 'decline', 'earnings', 'take home', 'work mode', 'vip', 'picked up', 'mark delivered', 'cash trip', 'commission', 'deduction'],
    answer: 'Switch "Working time" to Online to receive requests: it rings, you Accept or Decline, then "Mark Picked Up - Start Trip" and "Mark Delivered - Complete Trip". You take home the exact fare with no further deductions. On cash trips you keep the fare and the platform charge is deducted from your wallet at completion (a shortfall is recovered from your next wallet-paid trip). Store-delivery earnings arrive after the customer confirms receipt. Work Mode lets you set normal, VIP, discount or return pricing.',
  },
  {
    id: 'boda-rider-card', app: 'bodagoera', title: 'Rider ID card',
    keywords: ['rider id', 'id card', 'rider card', 'card fee', 'renew card', 'card expired', 'card qr'],
    answer: 'The district chairperson issues the rider ID card, or you request it; you pay the fee from your wallet with your PIN. It is valid for one year and can be renewed in the last 30 days. Its QR opens a public check that shows only the card status.',
  },
  {
    id: 'boda-leadership', app: 'bodagoera', title: 'Chairpersons and leadership',
    keywords: ['chairperson', 'stage', 'district', 'division', 'subcounty', 'parish', 'vote', 'leadership', 'remove chairperson', 'committee'],
    answer: 'Leadership runs District > Division > Subcounty > Parish > Stage. Chairpersons must also be riders, assign riders in their area, and earn a share of the platform charge. Riders and chairpersons can vote to remove a chairperson when more than half of all eligible voters agree.',
  },
  {
    id: 'boda-journeys', app: 'bodagoera', title: 'Global journeys and air tickets',
    keywords: ['journey', 'journeys', 'flight', 'flights', 'air ticket', 'airport', 'ship', 'cargo', 'sea', 'buy abroad', 'ticket', 'travel', 'fly', 'flying'],
    answer: 'Inside Book a Ride, "Flying somewhere?" opens Book a Journey: flights, ship cargo or buy-abroad, with optional rides to and from the airport (up to 9 travellers, 4 per car). Flights are charged in ICAN from your wallet, so top up first; if a flight fails before payment you are not charged. "Download air ticket" gives a PDF whose QR opens a public check at /ticket/<code> showing whether it is genuine, flown, cancelled or awaiting the airline.',
    followUps: ['Do I get a refund if no driver is found?', 'How do I check my ticket?'],
  },
  {
    id: 'boda-journey-refunds', app: 'bodagoera', title: 'Journey refunds',
    keywords: ['refund', 'no driver', 'cancel journey', 'ticket refund', 'airport ride refund', 'not charged'],
    answer: 'If no driver is found for an airport ride within the grace period (30 minutes by default) that ground leg is refunded. Cancelling a journey refunds ground rides that have no accepted driver, but the air ticket itself is not refunded and stays valid. If you think you were charged wrongly, message the team.',
    handoff: true,
  },
  {
    id: 'boda-shop-receipts', app: 'bodagoera', title: 'Shop and delivery receipts',
    keywords: ['shop', 'store', 'scan and checkout', 'cart', 'receipt', 'verify', 'received', 'i have received this', 'store staff approve', 'cashback', 'pickup'],
    answer: 'The Shop tab is Scan & Checkout: pick the store first (a cart holds one store), scan barcodes or browse, and pay with your wallet and PIN; cash, card and Mobile Money are settled on the store\'s website. The receipt has a PDF and QR and is approved by the store\'s staff, never the buyer. For delivery receipts (/verify/<code>) the store approves pickup (which pays the store), the rider delivers, and you tap "I\'ve Received This" (which pays the rider); a code can be approved only once.',
  },
  {
    id: 'boda-booking-link', app: 'bodagoera', title: 'A booking link from a business',
    keywords: ['book link', '/book', 'booking link', 'bk code', 'business sent me', 'era api booking', 'confirm booking', 'book it'],
    answer: 'If a business sent you a bodagoera.icanera.space/book/<code> link, nothing is booked or charged until you sign in with Google, review the quote, choose wallet or cash and tap "Book it". BodaGoEra sets the price, never the business, and the link expires.',
  },
  {
    id: 'boda-instalments', app: 'bodagoera', title: 'Instalments in BodaGoEra',
    keywords: ['instalment', 'installment', 'installments', 'pay in installments', 'plan status', 'waiting for deposit'],
    answer: 'The Installments tab lists your plans (weekly, 2-weekly or monthly payments). Pay from your wallet with no fee, or with Mobile Money, card or bank (processing fee). Money is held until you collect or receive the goods; cancelling returns it to your wallet, minus a cancel fee outside the cooling-off period.',
    links: ['plans'],
  },
  {
    id: 'boda-alerts', app: 'bodagoera', title: 'Alerts and installing',
    keywords: ['notification', 'notifications', 'alerts', 'turn on alerts', 'ringtone', 'install', 'add to home screen', 'ringing', 'push'],
    answer: 'Tap "Turn on alerts" to get ride requests, messages and calls even when the app is closed (on iPhone, add BodaGoEra to your Home Screen first). Riders can pick a new-job ringtone on "My Ringtone". The app installs like an app from the "Install app" button.',
  },
  {
    id: 'boda-help', app: 'bodagoera', title: 'Getting help in BodaGoEra',
    keywords: ['help', 'support', 'contact', 'problem', 'stuck', 'complain', 'chat with support'],
    answer: 'Use the "BodaGoEra Support" chat bubble in the app, or the "Ask us something" form on the landing page (public messages can be removed by the team). For a stuck journey payment the app tells you to contact the support team; for anything about your account, message the team here.',
    handoff: true,
  },
];
