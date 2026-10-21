// The company and the family as a whole: which app for what, one account, how to get help, staying safe.
// Curated from the apps' own code and copy; see familyKnowledge.js for the rules.
export const TOPICS = [
  {
    id: 'company-overview', app: null, core: true, title: 'GODMINDERA and the IcanEra family',
    keywords: ['godmindera', 'company', 'who are you', 'who owns', 'owner', 'about you', 'about the company', 'behind', 'family', 'apps'],
    answer: 'GODMINDERA ORGANISATION (U) LTD is the Ugandan company behind the IcanEra family of apps: IcanEra (wallet, coin and business tools), SupermartKera (shopping and supermarket operations), BodaGoEra (rides, deliveries and journeys) and AgriBone (agriculture). They share one IcanEra account and wallet.',
    followUps: ['Which app is right for me?', 'What is IcanEra?'],
  },
  {
    id: 'which-app', app: null, core: true, title: 'Which app is for what',
    keywords: ['which app', 'right for me', 'what apps', 'where do i start', 'get started', 'getting started', 'start', 'recommend'],
    answer: 'IcanEra: your money (wallet, ICAN coin, payments) and business tools. SupermartKera: shop at a store, or run a supermarket or shop (till, stock, suppliers). BodaGoEra: book a boda, car or delivery, travel, or work as a rider. AgriBone: farmers, suppliers and farm specialists. Tell me what you want to do and I will point you to the right one.',
    links: ['icanera', 'supermartkera', 'bodagoera'],
    followUps: ['I want to book a ride', 'I run a shop', 'I am a farmer'],
  },
  {
    id: 'one-account', app: null, core: true, title: 'One account and wallet across the apps',
    keywords: ['same account', 'one account', 'same wallet', 'one wallet', 'across apps', 'other app', 'sign in', 'login', 'log in', 'wallet number', 'account number'],
    answer: 'The apps share one IcanEra account and wallet, so your wallet works in all of them. SupermartKera and BodaGoEra let you sign in with Google, with email and password, or with your wallet account number (or phone) and your 4-6 digit wallet PIN.',
    followUps: ['I forgot my PIN', 'How do I create an account?'],
  },
  {
    id: 'getting-help', app: null, core: true, title: 'Getting help from a person',
    keywords: ['contact', 'support', 'human', 'real person', 'speak to', 'talk to', 'phone number', 'email', 'whatsapp', 'complaint', 'team', 'agent', 'reach'],
    answer: 'For anything about your own account, money, orders or a problem I cannot solve, tap "Message the team" here and a real person will reply in this chat. The apps also have their own support chat. I cannot see your account, so please do not send your PIN, password or any code.',
    handoff: true,
  },
  {
    id: 'stay-safe', app: null, core: true, title: 'Staying safe',
    keywords: ['scam', 'safe', 'safety', 'fraud', 'fake', 'phishing', 'hacked', 'share pin', 'otp', 'one-time code', 'suspicious', 'stolen'],
    answer: 'Never share your PIN, password or any one-time code with anyone, including people who say they work for us. We will never ask for them. Only use the links on this site or inside the apps. If you think someone has your PIN, reset it straight away from "Forgot PIN" and tell the team here.',
    links: ['reset-pin'],
    handoff: true,
  },
  {
    id: 'agribone-address', app: 'agribone', title: 'AgriBone web address',
    keywords: ['agribone link', 'agribone address', 'agribone website', 'agribone url', 'agribone site', 'where is agribone', 'open agribone'],
    answer: 'I do not have AgriBone\'s public web address to give you here. Message the team and they will send you the right link.',
    handoff: true,
  },
];
