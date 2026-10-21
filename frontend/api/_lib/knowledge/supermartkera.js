// SupermartKera: shopping and supermarket operations (supermartkera.icanera.space). Facts from the app's own code and copy.
// Left out on purpose: wishlist, loyalty points, cashback, the tracking-number box and the staff invite link (not working today).
export const TOPICS = [
  {
    id: 'smk-overview', app: 'supermartkera', core: true, title: 'What SupermartKera is',
    keywords: ['supermartkera', 'supermart kera', 'supermart', 'supermarket', 'what is supermartkera', 'smk'],
    answer: 'SupermartKera (supermartkera.icanera.space) helps supermarket teams run their till (POS), scan-and-pay, inventory, reports, staff and supplier work in one place, and lets customers shop at a store. It works for supermarkets, pharmacies, hotels, boutiques, restaurants and cafes, wholesale, hardware, factories and laundries. It is built on IcanEra and shares your IcanEra wallet.',
    links: ['supermartkera'],
    followUps: ['How do I shop?', 'How do I set up my store?', 'How does a cashier get access?'],
  },
  {
    id: 'smk-signin', app: 'supermartkera', title: 'Signing in and registering',
    keywords: ['sign in', 'login', 'log in', 'register', 'create account', 'sign up', 'customer account', 'forgot password', 'wallet login', 'google'],
    answer: 'Everyone signs in on one page (supermartkera.icanera.space/login): Continue with Google, your IcanEra wallet number or phone with your 4-6 digit PIN, or your email or phone with a password; "Forgot password?" emails a reset link. Customers register on the Register page (customer is the default) or with Google. After sign-in you land on your own portal: customer, cashier, manager, supplier or admin. A country must be set before you continue.',
    followUps: ['I forgot my PIN', 'How do I become a cashier?'],
  },
  {
    id: 'smk-shop', app: 'supermartkera', title: 'Shopping in the app',
    keywords: ['shop', 'shopping', 'cart', 'checkout', 'buy', 'scan', 'barcode', 'self checkout', 'self-checkout', 'which store', 'one store', 'order'],
    answer: 'In the Shop tab you first choose your store, then browse (search and categories) or scan a barcode. A cart holds one store only; switching store clears it after you confirm, and out-of-stock items are refused. Prices include tax. In-app checkout is with your IcanEra wallet and PIN; for cash, Mobile Money, card or bank use the button that opens the store\'s website to pay there.',
    followUps: ['How do I get my receipt?', 'Can I pay in instalments?'],
  },
  {
    id: 'smk-receipt', app: 'supermartkera', title: 'Receipts and approval',
    keywords: ['receipt', 'receipts', 'approve', 'approval', 'awaiting staff approval', 'approved by', 'qr receipt', 'pdf receipt', 'invoice', 'verify'],
    answer: 'After you pay in the Shop you get a receipt with the store, items, total and a QR code, and you can download a PDF. It first shows "Awaiting staff approval" and then "Approved by <staff name>": only that store\'s staff can approve it, never the buyer. Till receipts can be printed, saved as PDF or shared, and show VAT (18%) included; their QR opens the invoice page.',
  },
  {
    id: 'smk-till-pay', app: 'supermartkera', title: 'Taking payment at the till',
    keywords: ['till', 'pos', 'cashier', 'cashier portal', 'point of sale', 'take payment', 'mobile card', 'mobile/card', 'mobile pay', 'cash sale', 'pending sale', 'park sale', 'offline'],
    answer: 'On the cashier screen you can take IcanEra Wallet (the customer scans a QR), IcanEra Mobile / Card and Cash. Mobile / Card works three ways: type the customer\'s phone or 16-digit wallet number, pay on the till, or share a pay link by QR, WhatsApp or SMS. The store receives the full amount; the customer pays a processing fee (3.5% by default, shown first) unless they pay from their wallet. Sales are UGX 500 to 5,000,000, stay open 30 minutes, and up to 5 waiting sales can be parked. Cash sales can be queued offline and sync later; wallet and card need internet.',
    followUps: ['How do I add a cashier?', 'How do barcodes work?'],
  },
  {
    id: 'smk-cashier-access', app: 'supermartkera', title: 'Adding a cashier or manager',
    keywords: ['cashier', 'add cashier', 'add a cashier', 'become a cashier', 'cashier access', 'employee login', 'employee-auth', 'add manager', 'promote', 'pending admin approval', 'staff access', 'invite cashier', 'invite', 'approve account'],
    answer: '1) A manager uses "Add cashier" with the person\'s name, email and optional phone. 2) The cashier signs up at supermartkera.icanera.space/employee-auth with that exact email (or applies by choosing the supermarket). 3) An admin approves the account; until then it shows "pending admin approval". Managers are not self-registered: an admin promotes an existing account, and can assign roles to people who have already signed up.',
    handoff: true,
  },
  {
    id: 'smk-store-setup', app: 'supermartkera', title: 'Setting up a store',
    keywords: ['set up store', 'setup store', 'create store', 'open a store', 'admin setup', 'business type', 'store details', 'new supermarket', 'register my shop', 'i run a shop', 'start selling'],
    answer: 'The store owner (admin) creates the store in four steps: business type, store details, location, review. Then add products, staff and suppliers from the admin portal.',
    followUps: ['How do barcodes work?', 'How do suppliers work?'],
  },
  {
    id: 'smk-inventory', app: 'supermartkera', title: 'Inventory, barcodes, batches and expiry',
    keywords: ['inventory', 'stock', 'barcode', 'barcodes', 'label', 'labels', 'batch', 'batches', 'expiry', 'expiring', 'reorder', 'low stock', 'import', 'csv', 'wholesale', 'stock adjustment', 'reduced price'],
    answer: 'In the admin\'s "Order Inventory - POS" you control prices, minimum stock and reorder points, and import .csv, .xlsx, .xls or .pdf. A stock adjustment needs a reason. Admins can generate EAN-13 barcodes (starting with 2) for products that have none and print an A4 label sheet, three labels across; unknown barcodes show "not in this store\'s products". Each batch can have its own expiry and price, and the "Expiring stock · Reduced prices" panel publishes a reduced price that the till and customer checkout use at once. Wholesale, factory and hardware stores get wholesale price and quantity-tier pricing.',
  },
  {
    id: 'smk-suppliers', app: 'supermartkera', title: 'Suppliers and purchase orders',
    keywords: ['supplier', 'suppliers', 'purchase order', 'purchase orders', 'order from supplier', 'supplier portal', 'supplier payment', 'payment confirmation', 'catalog', 'farm produce'],
    answer: 'A manager\'s Orders pipeline runs Awaiting approval, Approved, With supplier, Confirmed, Received, Completed. Orders can be paid by cash or IcanEra wallet: for wallet payment nothing moves when you submit, and the business-wallet administrator must approve with the business-wallet PIN; cash payments are confirmed by the supplier in "Payment Confirmations". Suppliers sign up with Google or a form, apply to supermarkets inside their portal, and see live farmer offers in the "Farm Produce" tab (AgriBone), where they can call, WhatsApp or tap "I\'m interested" (UGX only, no in-app order or payment).',
  },
  {
    id: 'smk-reports', app: 'supermartkera', title: 'Reports and finance',
    keywords: ['report', 'reports', 'dashboard', 'average basket', 'sales report', 'transaction history', 'financial summary', 'payroll', 'staff management'],
    answer: 'Admin and manager dashboards show the last 7 and 30 days, average basket, low stock, out-of-stock, open purchase orders and wallet. Admins have Transaction History and cashiers have My Receipts. Stock purchases post to the shared IcanEra ledger so they reach the owner\'s Financial Summary. Stores with 3 or more workers are pointed to full CMMS for payroll, assets and transport ("Open ICANera CMMS").',
  },
  {
    id: 'smk-delivery', app: 'supermartkera', title: 'Delivery',
    keywords: ['delivery', 'deliver', 'rider', 'delivery fare', 'deliver within', 'refund window', 'boda', 'book ride'],
    answer: 'The Delivery tab uses BodaGoEra riders. Choose the store and goods, then how soon you need it ("Deliver within" 1 to 48 hours). The delivery fare is separate from the goods price. Pay by IcanEra Wallet or cash to the rider; if the rider misses your window you can claim a refund from your order receipt.',
    links: ['bodagoera'],
  },
  {
    id: 'smk-instalments', app: 'supermartkera', title: 'Pay in instalments',
    keywords: ['instalment', 'instalments', 'installment', 'installments', 'pay later', 'deposit', 'payment plan'],
    answer: 'On the Installments tab choose a deposit, the number of payments and how often. Items are reserved while you pay; when it is fully paid you collect or have it delivered, and the seller is paid only after the store scans your QR or code. Paying from your wallet has no fee; Mobile Money, card or bank add a processing fee. The exact terms come from the store, so check them on the plan.',
    links: ['plans'],
  },
  {
    id: 'smk-fees', app: 'supermartkera', title: 'Fees in SupermartKera',
    keywords: ['fee', 'fees', 'charge', 'processing fee', 'vat', 'tax', 'how much', 'cost'],
    answer: 'Paying from your IcanEra wallet has no processing fee, and sending between wallets is free. Mobile Money or card through a pay link adds a processing fee (3.5% by default, shown before you pay). Selling ICAN coin or cashing it out to Mobile Money or bank costs 3%. Prices include tax, and receipts show 18% VAT included.',
  },
  {
    id: 'smk-help', app: 'supermartkera', title: 'Getting help in SupermartKera',
    keywords: ['help', 'support', 'contact', 'chat with support', 'need help', 'complain'],
    answer: 'In the customer dashboard open "Need Help? Chat with Support" (the chat bubble: Supermartkera Support, My Store Team and Community). The landing page has a Contact us form; messages there are public unless you are signed in with a wallet and choose Private. For account problems, message the team here.',
    handoff: true,
  },
];
