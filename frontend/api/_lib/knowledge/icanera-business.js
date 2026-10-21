// IcanEra for businesses: the CMMS workspace, business websites, Pitchin, shop/resell, insurance, franchise, developer API.
// Facts from the web app and its deploy docs. Anything the code only half-delivers (plan enforcement, annual billing, sector
// trading, automatic franchise payouts) is deliberately left out or hedged so the assistant hands it to the team.
export const TOPICS = [
  {
    id: 'cmms-overview', app: 'icanera', core: true, title: 'CMMS, the business workspace',
    keywords: ['cmms', 'workspace', 'business tools', 'business workspace', 'manage staff', 'run my business', 'company profile', 'departments', 'modules', 'features'],
    answer: 'CMMS is the business workspace inside IcanEra: staff and roles, attendance by QR, payroll from the business wallet, inventory and assets, requisitions with supplier bids, reports, tasks, visitor management, announcements and jobs, and clinical or school modules. The first time, choose your business category and create the company profile; you become its admin. Modules are opt-in: the admin switches on the ones you need under "Choose CMMS features".',
    followUps: ['How do I add staff and roles?', 'How does attendance work?', 'How do I get a business website?'],
  },
  {
    id: 'cmms-roles', app: 'icanera', title: 'Staff, roles and who sees what',
    keywords: ['roles', 'role configuration', 'permissions', 'access', 'who can see', 'add staff', 'add employee', 'users', 'admin', 'staff account'],
    answer: 'The admin defines roles in Role Configuration and ticks which tools and actions (view, create, edit, approve, assign...) each role gets. A role sees a tool only if it has "view". Everyone active always keeps their own attendance and salary pages. Users, Payroll and Transport need your Pitchin business profile linked: teams under 3 active employees are linked automatically; from 3 employees the owner completes the full IcanEra business setup and returns to CMMS.',
  },
  {
    id: 'cmms-attendance', app: 'icanera', title: 'Staff attendance by QR',
    keywords: ['attendance', 'check in', 'check-in', 'check out', 'clock in', 'staff qr', 'qr code attendance', 'late', 'daily paid'],
    answer: 'A manager generates a location QR code in Staff Attendance > QR Codes. Staff scan it, sign in with their staff account and choose check-in or check-out. Managers also have a summary, a detailed log, manual check-in/out and leave tracking. Daily-paid staff confirm their pay at check-out.',
    facts: 'Visitors check in with a separate visitor QR and need no account.',
  },
  {
    id: 'cmms-visitors', app: 'icanera', title: 'Visitor management',
    keywords: ['visitor', 'visitors', 'visitor check in', 'visitor management', 'reception', 'vehicle'],
    answer: 'Visitor Management lets you register visitors, approve them, keep records and review suspicious ones. Visitors check in and out by QR with no account; a vehicle may need staff approval.',
  },
  {
    id: 'cmms-payroll', app: 'icanera', title: 'Payroll',
    keywords: ['payroll', 'salary', 'salaries', 'pay staff', 'advance', 'my salary', 'payslip'],
    answer: 'Payroll has payroll runs, staff on payroll, employee files and "My Salary" for each person. Salaries are paid from the business wallet and salary advances are supported. Payroll needs your Pitchin business profile linked.',
  },
  {
    id: 'cmms-inventory', app: 'icanera', title: 'Inventory, assets and requisitions',
    keywords: ['inventory', 'stock', 'assets', 'consumables', 'requisition', 'requisitions', 'purchase', 'supplier bids', 'procurement'],
    answer: 'Inventory is split into Assets (depreciated) and Consumables, with an append-only stock ledger. A requisition goes through department review, finance review and approval, can be opened for supplier bids, then ordered and completed; department or finance can reject it.',
  },
  {
    id: 'cmms-jobs', app: 'icanera', title: 'Jobs and applications',
    keywords: ['job', 'jobs', 'careers', 'hiring', 'apply', 'application', 'applicant', 'recruit', 'vacancy', 'interview', 'written test', 'reference code'],
    answer: 'Post jobs and announcements under Announcements & Jobs. Applicants apply on your business website\'s Careers tab with no account and get a reference code (JOB-...) to track their application. Stages: Submitted, Under review, Shortlisted, Written test, Interview, Hired, Rejected, Withdrawn. A written-test or interview link needs a lightweight IcanEra account.',
  },
  {
    id: 'site-address', app: 'icanera', title: 'Your business website address',
    keywords: ['website', 'business website', 'site address', 'my website', 'website address', 'icanera.space/', 'notices link', 'change address', 'business link', 'public page'],
    answer: 'Every business has a public website at icanera.space/<your-business-name>, made once from the name (a duplicate name gets -2, -3) and unchanged if you rename the business. A company admin can change it under CMMS > Company > Company Profile > "Your website address" (3 to 60 letters, numbers and single hyphens that are not reserved or taken); the old address keeps working. Old icanera.space/notices/<id> links still open the same site.',
    followUps: ['Why is a tab missing from my site?', 'How do customers pay on my site?'],
  },
  {
    id: 'site-tabs', app: 'icanera', title: 'Business website tabs',
    keywords: ['tab', 'tabs', 'missing tab', 'pitches', 'opportunities', 'library', 'market', 'my account', 'news', 'home tab'],
    answer: 'Home, News, Market, Pay and Careers are always there. Pitches appears when a Pitchin profile is linked. Opportunities and Library appear only once something is listed. "My account" appears when a profile is linked and customer accounts are on. The Library holds documents and links you choose; locked items need a password or PIN.',
  },
  {
    id: 'site-pay', app: 'icanera', title: 'Online payments on a business website',
    keywords: ['pay tab', 'online payments', 'switched on', 'turn on payments', 'customers pay', 'pay any amount', 'accept payments', 'payments not switched'],
    answer: 'The Pay tab lets customers pay any amount with cash, wallet, Mobile Money, card or bank, with no account. If the tab says online payments are not switched on, the owner has not enabled "pay any amount": a signed-in owner sees a "Turn on online payments" button there. The standing pay QR sends customers to this tab.',
  },
  {
    id: 'site-ask-us', app: 'icanera', title: 'The "Ask us" chat on a business website',
    keywords: ['ask us', 'chat bubble', 'chat widget', 'inquiries', 'enquiries', 'visitor messages', 'chatbot', 'assistant', 'team reply'],
    answer: 'The "Ask us" bubble on a business website is an AI assistant that answers only from the business\'s public facts. Visitors can leave a name and a phone or email to talk to the team, no account needed. Staff reply from CMMS > Announcements & Jobs > Inquiries and the reply appears in the same bubble.',
  },
  {
    id: 'opportunities', app: 'icanera', title: 'Business opportunities and bids',
    keywords: ['opportunity', 'opportunities', 'bid', 'bids', 'tender', 'quotation', 'supplier bid', 'bid reference'],
    answer: 'A company posts an opportunity and individuals or businesses bid. Bids are private to the company that posted it. Visitors can bid with no account and get a reference code (BID-...) to track the bid.',
  },
  {
    id: 'reports-sharing', app: 'icanera', title: 'Sharing reports safely',
    keywords: ['share report', 'report link', 'shareable report', 'password protected', 'restricted email', 'revoke', 'expiry', 'export reports'],
    answer: 'Share a report or a grouped export as Public, Password-protected (at least 4 characters) or Restricted to listed emails, with an optional expiry, and revoke the link at any time.',
  },
  {
    id: 'service-contracts', app: 'icanera', title: 'Service-provider contracts',
    keywords: ['contractor', 'service provider', 'service-provider', 'contract link', 'publish contract'],
    answer: 'A service-provider contract is published from Tasks (needs the publish_contract permission). The contractor needs no account: they open the link and unlock it with a PIN or a listed email, within 30 days by default (5 wrong PINs lock it for 15 minutes). Payment is cash or wallet.',
  },
  {
    id: 'pitchin', app: 'icanera', title: 'Pitchin: pitches, investors and agreements',
    keywords: ['pitchin', 'pitch', 'investor', 'investors', 'invest', 'private invite', 'agreement', 'escrow', 'verify agreement', 'pitch video'],
    answer: 'Pitchin lets a business post pitch videos (up to 3 minutes) and share them by link; viewers can watch without an account, but liking, commenting and investing need one. "Invite investor privately" makes a PIN-locked link that expires in 24 hours to 30 days, can be revoked and locks after 5 wrong PINs. Investments go to escrow and members sign; the printed agreement\'s QR opens a public page showing the live signers. I cannot give investment advice.',
    links: ['icanera'],
  },
  {
    id: 'tithe-church', app: 'icanera', title: 'Tithe and giving to a church',
    keywords: ['tithe', 'church', 'give to church', 'giving', 'offering', 'tithe calculator'],
    answer: 'Tithe is no longer taken from wallet earnings or payments: they are credited in full. The Tithe tab is optional, with a calculator and a "Give to Church" option to pay a registered church by IcanEra wallet (PIN), Mobile Money or card, or cash, optionally anonymously.',
  },
  {
    id: 'insurance', app: 'icanera', title: 'Insurance on IcanEra',
    keywords: ['insurance', 'insurer', 'cover', 'policy', 'claim', 'policyholder', 'insure'],
    answer: 'Customers find cover under Compliance > Insurance (My cover, Find cover) and can pay in ICAN from a wallet, a business wallet or reward points. Insurers apply on the landing page with no account; after support verifies the licence they sign up with the same email and register as an insurer. A public directory lists verified insurers with a current licence and at least one plan.',
    handoff: false,
  },
  {
    id: 'franchise', app: 'icanera', title: 'Franchise partners',
    keywords: ['franchise', 'agency', 'country master', 'partner', 'become a partner', 'agency code', 'referral partner'],
    answer: 'Registered companies can ask to become a franchise partner (Country Master, Agency or Referral) with the Franchise form on the landing page, no account needed. The company registration and owners are verified before the partner goes live. Customers join an agency by entering its code (like UG-AG-K7M2P) or its link. Payouts are handled manually by the team.',
    handoff: true,
  },
  {
    id: 'shop-resell', app: 'icanera', title: 'Shop, storefronts and reselling',
    keywords: ['resell', 'reselling', 'dropship', 'reseller', 'storefront', 'sell products', 'markup', '/shop', 'start reselling', 'store page'],
    answer: 'The IcanEra shop (icanera.space/shop) lists products you can buy. Anyone can start reselling for free: list a store\'s product at or above the store\'s price and keep the markup. Storefronts (icanera.space/store/<id>) are free to browse; delivery is by a BodaGoEra rider in a window you choose (1 to 48 hours); pay with a wallet (no extra fee) or with Mobile Money, card or bank without a wallet (adds a processing fee).',
    links: ['shop'],
  },
  {
    id: 'portfolio', app: 'icanera', title: 'Resume and portfolio page',
    keywords: ['portfolio', 'resume', 'curriculum vitae', 'profile page', 'professionals', 'personal page'],
    answer: 'You can build a free public resume page at icanera.space/portfolio/<your-handle> with sections for experience, research, education, achievements and presentations. Visitors can rate and chat with you.',
  },
  {
    id: 'era-api-keys', app: 'icanera', title: 'Developer API keys',
    keywords: ['api key', 'era_live', 'era_biz', 'era_test', 'business key', 'developer api', 'api limits', 'rate limit', 'scopes'],
    answer: 'There are three key types: sandbox (era_test_, instant, test data), live (era_live_, needs a person to approve your app) and business (era_biz_, created by the business owner under Business > Administration > Developer API). Business keys have scopes (payments, bookings, inventory, CMMS read), are shown once, expire within a year and can be revoked instantly. Sandbox is limited to 30 requests a minute, live to 60 by default. The API asks and reads; it never moves money.',
    links: ['developers'],
  },
  {
    id: 'cmms-pricing', app: 'icanera', title: 'CMMS pricing',
    keywords: ['pricing', 'price of cmms', 'how much is cmms', 'subscription', 'plan price', 'free trial', 'cmms cost', 'billing plan', 'team plan', 'corporate plan'],
    answer: 'The pricing page (icanera.space/pricing) lists CMMS plans by team size, billed in ICAN from the business wallet, with a 30-day trial. I cannot confirm what applies to your account right now, so please message the team for an exact quote.',
    handoff: true,
  },
  {
    id: 'public-vs-account', app: 'icanera', title: 'What needs an account',
    keywords: ['need an account', 'without account', 'no account', 'guest', 'do i need to sign up', 'without signing in'],
    answer: 'No account needed: business websites, the shop and storefront browsing, public pitches and updates, portfolios, shared reports and consultation forms, document and agreement checks, receipt and pay QR pages, the coin price chart and the developer portal. An account is needed for wallet-paid checkout, instalment plans, staff attendance, investing, liking and commenting, and written tests or interviews.',
  },
];
