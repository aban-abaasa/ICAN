// AgriBone: agriculture for Ugandan farmers. Facts from the app's own code and copy.
// AgriBone's public web address is not confirmed anywhere in its code, so no link is given (see company.js: agribone-address).
// Left out on purpose: weather and resources pages, community statistics, testimonials, marketplace supplier phone numbers and the
// footer contact details (all sample data or placeholders), in-app ordering (not built), staking.
export const TOPICS = [
  {
    id: 'agri-overview', app: 'agribone', core: true, title: 'What AgriBone is',
    keywords: ['agribone', 'agri bone', 'agri-tech', 'agritech', 'what is agribone', 'farm', 'farming', 'farmer', 'farmers', 'agriculture'],
    answer: 'AgriBone is an agriculture platform for Ugandan farmers and the people who serve them: customers who buy at the source, farmers, suppliers, on-ground farm specialists and partners. Payments are settled on the IcanEra wallet. It is a product of GODMINDERA ORGANISATION (U) LTD.',
    followUps: ['How do I become a farmer?', 'How do I tell suppliers what I have?', 'How do I become a supplier?'],
  },
  {
    id: 'agri-signup', app: 'agribone', title: 'Joining AgriBone',
    keywords: ['sign up', 'register', 'create account', 'join', 'sign in', 'login', 'google', 'confirm email'],
    answer: 'Create an account with your first name, last name, email and a password of at least 8 characters, or continue with Google, then confirm your email and sign in. Everyone starts as a customer; phone and location are asked later and are optional. The Join page lists the pathways: Customer, Farmer, On-Ground Support, Supplier and Partner & Investor.',
  },
  {
    id: 'agri-farmer', app: 'agribone', title: 'Becoming a farmer',
    keywords: ['become a farmer', 'farmer account', 'i am a farmer', 'start farming', 'farm type', 'farm size', 'livestock', 'crop', 'poultry', 'my farm', 'farm tools'],
    answer: 'In My Account open the "Become a Farmer" tab, pick your farming type (crop, livestock, mixed, plantation, aquaculture, poultry or other) and optionally your farm size in acres. No approval is needed and the Farmer tab opens straight away, with tools for your farm, livestock, inventory, soil and crop planning, selling produce and finding a specialist. Livestock records are kept on your own device.',
    followUps: ['How do I tell suppliers what I have?', 'How do I find a specialist?'],
  },
  {
    id: 'agri-produce-offers', app: 'agribone', title: 'Telling suppliers what you have (produce offers)',
    keywords: ['produce offer', 'produce offers', 'tell suppliers', 'sell produce', 'sell my crop', 'sell my produce', 'harvest', 'price per kg', 'offer expires', 'interested suppliers', 'sell to suppliers'],
    answer: 'Open "Tell suppliers what you have" (/produce-offers, sign-in needed): enter the crop, quantity, unit, your price in UGX, your area and phone, and choose how long it stays open (3, 7, 14 or 30 days). Suppliers on SupermartKera see it and can call, WhatsApp or tap "I\'m interested"; you can edit, pause, mark sold, renew or delete the offer. There is no in-app order or payment for farm produce yet, so agree price and delivery directly by phone.',
    handoff: false,
  },
  {
    id: 'agri-supplier-specialist', app: 'agribone', title: 'Becoming a supplier or farm specialist',
    keywords: ['become a supplier', 'supplier application', 'supply farms', 'specialist', 'farm specialist', 'on-ground support', 'on ground', 'agronomy', 'veterinary', 'apply', 'approval', 'application status', 'pending'],
    answer: 'Sign in, open /join/supplier or /join/support and submit the application. Suppliers give their business details and what they supply (seed, fertiliser and agro-chemicals, feed and veterinary inputs, tools and machinery, packaging and storage, labour) and agree to four standards: describe goods honestly, deliver on time, pay labour fairly and accept orders and payment through the ICAN wallet. Specialists name their region and experience and serve only the area they name. The AgriBone developer panel reviews every application; you will see Pending, Approved or Rejected (you may amend and apply again).',
    handoff: false,
  },
  {
    id: 'agri-marketplace', app: 'agribone', title: 'Marketplace and ordering',
    keywords: ['marketplace', 'listing', 'listings', 'buy land', 'lease', 'equipment', 'transport', 'create listing', 'order from farmers', 'buy at the source', 'checkout', 'cart'],
    answer: 'The Marketplace (sign-in needed) has listings for land, produce and services such as equipment, labour and transport, with search and filters, and you can create your own listing. Ordering and checkout are not built into AgriBone yet, so contact the seller directly and settle payment with your IcanEra wallet.',
    handoff: false,
  },
  {
    id: 'agri-wallet', app: 'agribone', title: 'Wallet and payments in AgriBone',
    keywords: ['wallet', 'pay', 'send', 'receive', 'buy ican', 'sell ican', 'withdraw', 'mobile money', 'cash out', 'pin', 'fee', 'fees'],
    answer: 'The IcanEra wallet in AgriBone has Pay (scan a QR and confirm with your PIN), Send, Receive (a payment-request QR and link valid for 24 hours), Buy and Sell. Your PIN is 4 to 6 digits. Sending to another wallet is free; cashing out to Mobile Money or bank, or selling ICAN for money, costs 3%, and a failed transfer is refunded automatically. If a top-up does not work, try another method or message the team.',
    handoff: false,
  },
  {
    id: 'agri-community-help', app: 'agribone', title: 'Community, events and help',
    keywords: ['community', 'ask us anything', 'events', 'register event', 'questions', 'discussion', 'chat', 'support', 'help', 'contact', 'language', 'kiswahili', 'luganda', 'french', 'install', 'offline'],
    answer: 'The Community area has discussions, questions and events you can register for. For help, use the AgriBone Support chat bubble or the "Ask Us Anything" board on the home page. The header offers English, French, Kiswahili and Luganda, though only the menus and settings are translated so far. AgriBone can be installed like an app, and pages you opened before load offline.',
    handoff: true,
  },
];
