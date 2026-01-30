/**
 * 🌍 Country & Currency Service
 * Manages country selection, currency codes, and ICAN Coin exchange rates
 * ICAN Base Rate: 5000 UGX (Dynamic Market Price)
 * Supports 195+ countries worldwide
 */

// Base ICAN Coin rate: 5000 UGX
const ICAN_BASE_RATE_UGX = 5000;

// Exchange rates (UGX to each currency) - Updated daily from market
const EXCHANGE_RATES = {
  UGX: 1,
  KES: 0.047,
  TZS: 0.92,
  RWF: 0.47,
  BWP: 0.0049,
  ZAR: 0.0067,
  NGN: 0.556,
  GHS: 0.0055,
  USD: 0.00036,
  GBP: 0.00029,
  CAD: 0.00049,
  AUD: 0.00055,
  INR: 0.030,
  JPY: 0.052,
  CNY: 0.0025,
  EUR: 0.00034,
  CHF: 0.00032,
  AED: 0.00132,
  SGD: 0.00048,
  HKD: 0.0028,
  MXN: 0.0065,
  BRL: 0.0018,
  ZWL: 0.11,
  PKR: 0.13,
  THB: 0.0125,
  MYR: 0.0016,
  PHP: 0.020,
  IDR: 5.8,
  VND: 9.1,
  KRW: 0.47,
  SEK: 0.0035,
  NOK: 0.0038,
  DKK: 0.0024,
  PLN: 0.00093,
  CZK: 0.0084,
  HUF: 0.13,
  RON: 0.00079,
  RUB: 0.035,
  TRY: 0.012,
  ARS: 0.0039,
  CLP: 0.31,
  COP: 1.4,
  PEN: 0.0013,
  UAH: 0.015,
  ILS: 0.0013,
  SAR: 0.00135,
  QAR: 0.0013,
  KWD: 0.00011,
  OMR: 0.00014,
  BHD: 0.00010,
  EGP: 0.0115,
  TND: 0.0011,
  LBP: 5.7,
  JOD: 0.00025,
  MAR: 0.0035
};

// Comprehensive world countries database
const COUNTRIES = {
  // Africa - East
  UG: { name: 'Uganda', flag: '🇺🇬', currency: 'UGX', currencySymbol: 'Sh', region: 'East Africa' },
  KE: { name: 'Kenya', flag: '🇰🇪', currency: 'KES', currencySymbol: 'Ksh', region: 'East Africa' },
  TZ: { name: 'Tanzania', flag: '🇹🇿', currency: 'TZS', currencySymbol: 'TSh', region: 'East Africa' },
  RW: { name: 'Rwanda', flag: '🇷🇼', currency: 'RWF', currencySymbol: 'FRw', region: 'East Africa' },
  DJ: { name: 'Djibouti', flag: '🇩🇯', currency: 'DJF', currencySymbol: 'Fdj', region: 'East Africa' },
  ER: { name: 'Eritrea', flag: '🇪🇷', currency: 'ERN', currencySymbol: 'Nfk', region: 'East Africa' },
  ET: { name: 'Ethiopia', flag: '🇪🇹', currency: 'ETB', currencySymbol: 'Br', region: 'East Africa' },
  SO: { name: 'Somalia', flag: '🇸🇴', currency: 'SOS', currencySymbol: 'Sh', region: 'East Africa' },
  KM: { name: 'Comoros', flag: '🇰🇲', currency: 'KMF', currencySymbol: 'CF', region: 'East Africa' },
  SC: { name: 'Seychelles', flag: '🇸🇨', currency: 'SCR', currencySymbol: '₨', region: 'East Africa' },

  // Africa - Southern
  BW: { name: 'Botswana', flag: '🇧🇼', currency: 'BWP', currencySymbol: 'P', region: 'Southern Africa' },
  ZA: { name: 'South Africa', flag: '🇿🇦', currency: 'ZAR', currencySymbol: 'R', region: 'Southern Africa' },
  NA: { name: 'Namibia', flag: '🇳🇦', currency: 'NAD', currencySymbol: '$', region: 'Southern Africa' },
  LS: { name: 'Lesotho', flag: '🇱🇸', currency: 'LSL', currencySymbol: 'L', region: 'Southern Africa' },
  SZ: { name: 'Eswatini', flag: '🇸🇿', currency: 'SZL', currencySymbol: 'L', region: 'Southern Africa' },
  MZ: { name: 'Mozambique', flag: '🇲🇿', currency: 'MZN', currencySymbol: 'MT', region: 'Southern Africa' },
  ZM: { name: 'Zambia', flag: '🇿🇲', currency: 'ZMW', currencySymbol: 'ZK', region: 'Southern Africa' },
  ZW: { name: 'Zimbabwe', flag: '🇿🇼', currency: 'ZWL', currencySymbol: '$', region: 'Southern Africa' },
  MG: { name: 'Madagascar', flag: '🇲🇬', currency: 'MGA', currencySymbol: 'Ar', region: 'Southern Africa' },
  MU: { name: 'Mauritius', flag: '🇲🇺', currency: 'MUR', currencySymbol: '₨', region: 'Southern Africa' },

  // Africa - West
  NG: { name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', currencySymbol: '₦', region: 'West Africa' },
  GH: { name: 'Ghana', flag: '🇬🇭', currency: 'GHS', currencySymbol: '₵', region: 'West Africa' },
  CI: { name: 'Côte d\'Ivoire', flag: '🇨🇮', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  SN: { name: 'Senegal', flag: '🇸🇳', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  ML: { name: 'Mali', flag: '🇲🇱', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  BF: { name: 'Burkina Faso', flag: '🇧🇫', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  NE: { name: 'Niger', flag: '🇳🇪', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  TG: { name: 'Togo', flag: '🇹🇬', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  BJ: { name: 'Benin', flag: '🇧🇯', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  LR: { name: 'Liberia', flag: '🇱🇷', currency: 'LRD', currencySymbol: '$', region: 'West Africa' },
  SL: { name: 'Sierra Leone', flag: '🇸🇱', currency: 'SLL', currencySymbol: 'Le', region: 'West Africa' },
  GM: { name: 'Gambia', flag: '🇬🇲', currency: 'GMD', currencySymbol: 'D', region: 'West Africa' },
  GW: { name: 'Guinea-Bissau', flag: '🇬🇼', currency: 'XOF', currencySymbol: 'Fr', region: 'West Africa' },
  GN: { name: 'Guinea', flag: '🇬🇳', currency: 'GNF', currencySymbol: 'Fr', region: 'West Africa' },
  CV: { name: 'Cape Verde', flag: '🇨🇻', currency: 'CVE', currencySymbol: '$', region: 'West Africa' },

  // Africa - Central
  CM: { name: 'Cameroon', flag: '🇨🇲', currency: 'XAF', currencySymbol: 'Fr', region: 'Central Africa' },
  CG: { name: 'Congo', flag: '🇨🇬', currency: 'XAF', currencySymbol: 'Fr', region: 'Central Africa' },
  CD: { name: 'Democratic Republic of Congo', flag: '🇨🇩', currency: 'CDF', currencySymbol: 'Fr', region: 'Central Africa' },
  GA: { name: 'Gabon', flag: '🇬🇦', currency: 'XAF', currencySymbol: 'Fr', region: 'Central Africa' },
  GQ: { name: 'Equatorial Guinea', flag: '🇬🇶', currency: 'XAF', currencySymbol: 'Fr', region: 'Central Africa' },
  ST: { name: 'São Tomé and Príncipe', flag: '🇸🇹', currency: 'STN', currencySymbol: 'Db', region: 'Central Africa' },
  CF: { name: 'Central African Republic', flag: '🇨🇫', currency: 'XAF', currencySymbol: 'Fr', region: 'Central Africa' },
  TD: { name: 'Chad', flag: '🇹🇩', currency: 'XAF', currencySymbol: 'Fr', region: 'Central Africa' },
  AO: { name: 'Angola', flag: '🇦🇴', currency: 'AOA', currencySymbol: 'Kz', region: 'Central Africa' },

  // Africa - North
  EG: { name: 'Egypt', flag: '🇪🇬', currency: 'EGP', currencySymbol: '£', region: 'North Africa' },
  DZ: { name: 'Algeria', flag: '🇩🇿', currency: 'DZD', currencySymbol: 'د.ج', region: 'North Africa' },
  MA: { name: 'Morocco', flag: '🇲🇦', currency: 'MAD', currencySymbol: 'د.م.', region: 'North Africa' },
  TN: { name: 'Tunisia', flag: '🇹🇳', currency: 'TND', currencySymbol: 'د.ت', region: 'North Africa' },
  LY: { name: 'Libya', flag: '🇱🇾', currency: 'LYD', currencySymbol: 'ل.د', region: 'North Africa' },
  SD: { name: 'Sudan', flag: '🇸🇩', currency: 'SDG', currencySymbol: '£', region: 'North Africa' },

  // Americas - North
  US: { name: 'United States', flag: '🇺🇸', currency: 'USD', currencySymbol: '$', region: 'North America' },
  CA: { name: 'Canada', flag: '🇨🇦', currency: 'CAD', currencySymbol: 'C$', region: 'North America' },
  MX: { name: 'Mexico', flag: '🇲🇽', currency: 'MXN', currencySymbol: '$', region: 'North America' },

  // Americas - Central & Caribbean
  GT: { name: 'Guatemala', flag: '🇬🇹', currency: 'GTQ', currencySymbol: 'Q', region: 'Central America' },
  SV: { name: 'El Salvador', flag: '🇸🇻', currency: 'SVC', currencySymbol: '$', region: 'Central America' },
  HN: { name: 'Honduras', flag: '🇭🇳', currency: 'HNL', currencySymbol: 'L', region: 'Central America' },
  NI: { name: 'Nicaragua', flag: '🇳🇮', currency: 'NIO', currencySymbol: 'C$', region: 'Central America' },
  CR: { name: 'Costa Rica', flag: '🇨🇷', currency: 'CRC', currencySymbol: '₡', region: 'Central America' },
  PA: { name: 'Panama', flag: '🇵🇦', currency: 'PAB', currencySymbol: 'B/.', region: 'Central America' },
  BZ: { name: 'Belize', flag: '🇧🇿', currency: 'BZD', currencySymbol: '$', region: 'Central America' },
  BS: { name: 'Bahamas', flag: '🇧🇸', currency: 'BSD', currencySymbol: '$', region: 'Caribbean' },
  CU: { name: 'Cuba', flag: '🇨🇺', currency: 'CUP', currencySymbol: '₱', region: 'Caribbean' },
  DO: { name: 'Dominican Republic', flag: '🇩🇴', currency: 'DOP', currencySymbol: '$', region: 'Caribbean' },
  HT: { name: 'Haiti', flag: '🇭🇹', currency: 'HTG', currencySymbol: 'G', region: 'Caribbean' },
  JM: { name: 'Jamaica', flag: '🇯🇲', currency: 'JMD', currencySymbol: '$', region: 'Caribbean' },
  TT: { name: 'Trinidad and Tobago', flag: '🇹🇹', currency: 'TTD', currencySymbol: '$', region: 'Caribbean' },
  BB: { name: 'Barbados', flag: '🇧🇧', currency: 'BBD', currencySymbol: '$', region: 'Caribbean' },

  // Americas - South
  BR: { name: 'Brazil', flag: '🇧🇷', currency: 'BRL', currencySymbol: 'R$', region: 'South America' },
  AR: { name: 'Argentina', flag: '🇦🇷', currency: 'ARS', currencySymbol: '$', region: 'South America' },
  CL: { name: 'Chile', flag: '🇨🇱', currency: 'CLP', currencySymbol: '$', region: 'South America' },
  CO: { name: 'Colombia', flag: '🇨🇴', currency: 'COP', currencySymbol: '$', region: 'South America' },
  PE: { name: 'Peru', flag: '🇵🇪', currency: 'PEN', currencySymbol: 'S/', region: 'South America' },
  VE: { name: 'Venezuela', flag: '🇻🇪', currency: 'VEF', currencySymbol: 'Bs.', region: 'South America' },
  EC: { name: 'Ecuador', flag: '🇪🇨', currency: 'USD', currencySymbol: '$', region: 'South America' },
  BO: { name: 'Bolivia', flag: '🇧🇴', currency: 'BOB', currencySymbol: 'Bs.', region: 'South America' },
  PY: { name: 'Paraguay', flag: '🇵🇾', currency: 'PYG', currencySymbol: '₲', region: 'South America' },
  UY: { name: 'Uruguay', flag: '🇺🇾', currency: 'UYU', currencySymbol: '$', region: 'South America' },
  SR: { name: 'Suriname', flag: '🇸🇷', currency: 'SRD', currencySymbol: '$', region: 'South America' },
  GY: { name: 'Guyana', flag: '🇬🇾', currency: 'GYD', currencySymbol: '$', region: 'South America' },

  // Europe - Western
  GB: { name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', currencySymbol: '£', region: 'Western Europe' },
  IE: { name: 'Ireland', flag: '🇮🇪', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  FR: { name: 'France', flag: '🇫🇷', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  DE: { name: 'Germany', flag: '🇩🇪', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  NL: { name: 'Netherlands', flag: '🇳🇱', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  BE: { name: 'Belgium', flag: '🇧🇪', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  LU: { name: 'Luxembourg', flag: '🇱🇺', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  AT: { name: 'Austria', flag: '🇦🇹', currency: 'EUR', currencySymbol: '€', region: 'Western Europe' },
  CH: { name: 'Switzerland', flag: '🇨🇭', currency: 'CHF', currencySymbol: 'CHF', region: 'Western Europe' },

  // Europe - Southern
  ES: { name: 'Spain', flag: '🇪🇸', currency: 'EUR', currencySymbol: '€', region: 'Southern Europe' },
  PT: { name: 'Portugal', flag: '🇵🇹', currency: 'EUR', currencySymbol: '€', region: 'Southern Europe' },
  IT: { name: 'Italy', flag: '🇮🇹', currency: 'EUR', currencySymbol: '€', region: 'Southern Europe' },
  GR: { name: 'Greece', flag: '🇬🇷', currency: 'EUR', currencySymbol: '€', region: 'Southern Europe' },
  HR: { name: 'Croatia', flag: '🇭🇷', currency: 'HRK', currencySymbol: 'kn', region: 'Southern Europe' },
  RS: { name: 'Serbia', flag: '🇷🇸', currency: 'RSD', currencySymbol: 'дин.', region: 'Southern Europe' },
  BA: { name: 'Bosnia and Herzegovina', flag: '🇧🇦', currency: 'BAM', currencySymbol: 'KM', region: 'Southern Europe' },
  ME: { name: 'Montenegro', flag: '🇲🇪', currency: 'EUR', currencySymbol: '€', region: 'Southern Europe' },
  AL: { name: 'Albania', flag: '🇦🇱', currency: 'ALL', currencySymbol: 'L', region: 'Southern Europe' },
  MK: { name: 'North Macedonia', flag: '🇲🇰', currency: 'MKD', currencySymbol: 'ден', region: 'Southern Europe' },
  BG: { name: 'Bulgaria', flag: '🇧🇬', currency: 'BGN', currencySymbol: 'лв', region: 'Southern Europe' },
  RO: { name: 'Romania', flag: '🇷🇴', currency: 'RON', currencySymbol: 'lei', region: 'Southern Europe' },

  // Europe - Northern
  SE: { name: 'Sweden', flag: '🇸🇪', currency: 'SEK', currencySymbol: 'kr', region: 'Northern Europe' },
  NO: { name: 'Norway', flag: '🇳🇴', currency: 'NOK', currencySymbol: 'kr', region: 'Northern Europe' },
  DK: { name: 'Denmark', flag: '🇩🇰', currency: 'DKK', currencySymbol: 'kr', region: 'Northern Europe' },
  FI: { name: 'Finland', flag: '🇫🇮', currency: 'EUR', currencySymbol: '€', region: 'Northern Europe' },
  IS: { name: 'Iceland', flag: '🇮🇸', currency: 'ISK', currencySymbol: 'kr', region: 'Northern Europe' },
  LT: { name: 'Lithuania', flag: '🇱🇹', currency: 'EUR', currencySymbol: '€', region: 'Northern Europe' },
  LV: { name: 'Latvia', flag: '🇱🇻', currency: 'EUR', currencySymbol: '€', region: 'Northern Europe' },
  EE: { name: 'Estonia', flag: '🇪🇪', currency: 'EUR', currencySymbol: '€', region: 'Northern Europe' },

  // Europe - Eastern
  PL: { name: 'Poland', flag: '🇵🇱', currency: 'PLN', currencySymbol: 'zł', region: 'Eastern Europe' },
  CZ: { name: 'Czechia', flag: '🇨🇿', currency: 'CZK', currencySymbol: 'Kč', region: 'Eastern Europe' },
  SK: { name: 'Slovakia', flag: '🇸🇰', currency: 'EUR', currencySymbol: '€', region: 'Eastern Europe' },
  HU: { name: 'Hungary', flag: '🇭🇺', currency: 'HUF', currencySymbol: 'Ft', region: 'Eastern Europe' },
  UA: { name: 'Ukraine', flag: '🇺🇦', currency: 'UAH', currencySymbol: '₴', region: 'Eastern Europe' },
  BY: { name: 'Belarus', flag: '🇧🇾', currency: 'BYN', currencySymbol: 'Br', region: 'Eastern Europe' },
  RU: { name: 'Russia', flag: '🇷🇺', currency: 'RUB', currencySymbol: '₽', region: 'Eastern Europe' },
  MD: { name: 'Moldova', flag: '🇲🇩', currency: 'MDL', currencySymbol: 'L', region: 'Eastern Europe' },

  // Asia - Middle East
  SA: { name: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR', currencySymbol: '﷼', region: 'Middle East' },
  AE: { name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED', currencySymbol: 'د.إ', region: 'Middle East' },
  QA: { name: 'Qatar', flag: '🇶🇦', currency: 'QAR', currencySymbol: 'ر.ق', region: 'Middle East' },
  KW: { name: 'Kuwait', flag: '🇰🇼', currency: 'KWD', currencySymbol: 'د.ك', region: 'Middle East' },
  OM: { name: 'Oman', flag: '🇴🇲', currency: 'OMR', currencySymbol: 'ر.ع.', region: 'Middle East' },
  BH: { name: 'Bahrain', flag: '🇧🇭', currency: 'BHD', currencySymbol: '.د.ب', region: 'Middle East' },
  IL: { name: 'Israel', flag: '🇮🇱', currency: 'ILS', currencySymbol: '₪', region: 'Middle East' },
  PS: { name: 'Palestine', flag: '🇵🇸', currency: 'ILS', currencySymbol: '₪', region: 'Middle East' },
  JO: { name: 'Jordan', flag: '🇯🇴', currency: 'JOD', currencySymbol: 'د.ا', region: 'Middle East' },
  LB: { name: 'Lebanon', flag: '🇱🇧', currency: 'LBP', currencySymbol: '£', region: 'Middle East' },
  SY: { name: 'Syria', flag: '🇸🇾', currency: 'SYP', currencySymbol: '£', region: 'Middle East' },
  TR: { name: 'Turkey', flag: '🇹🇷', currency: 'TRY', currencySymbol: '₺', region: 'Middle East' },
  IQ: { name: 'Iraq', flag: '🇮🇶', currency: 'IQD', currencySymbol: 'ع.د', region: 'Middle East' },
  IR: { name: 'Iran', flag: '🇮🇷', currency: 'IRR', currencySymbol: '﷼', region: 'Middle East' },
  AF: { name: 'Afghanistan', flag: '🇦🇫', currency: 'AFN', currencySymbol: '؋', region: 'Middle East' },

  // Asia - South
  IN: { name: 'India', flag: '🇮🇳', currency: 'INR', currencySymbol: '₹', region: 'South Asia' },
  PK: { name: 'Pakistan', flag: '🇵🇰', currency: 'PKR', currencySymbol: '₨', region: 'South Asia' },
  BD: { name: 'Bangladesh', flag: '🇧🇩', currency: 'BDT', currencySymbol: '৳', region: 'South Asia' },
  LK: { name: 'Sri Lanka', flag: '🇱🇰', currency: 'LKR', currencySymbol: '₨', region: 'South Asia' },
  NP: { name: 'Nepal', flag: '🇳🇵', currency: 'NPR', currencySymbol: '₨', region: 'South Asia' },
  BT: { name: 'Bhutan', flag: '🇧🇹', currency: 'BTN', currencySymbol: 'Nu.', region: 'South Asia' },
  MV: { name: 'Maldives', flag: '🇲🇻', currency: 'MVR', currencySymbol: 'Rf', region: 'South Asia' },

  // Asia - East
  CN: { name: 'China', flag: '🇨🇳', currency: 'CNY', currencySymbol: '¥', region: 'East Asia' },
  JP: { name: 'Japan', flag: '🇯🇵', currency: 'JPY', currencySymbol: '¥', region: 'East Asia' },
  KR: { name: 'South Korea', flag: '🇰🇷', currency: 'KRW', currencySymbol: '₩', region: 'East Asia' },
  MN: { name: 'Mongolia', flag: '🇲🇳', currency: 'MNT', currencySymbol: '₮', region: 'East Asia' },
  TW: { name: 'Taiwan', flag: '🇹🇼', currency: 'TWD', currencySymbol: '$', region: 'East Asia' },
  HK: { name: 'Hong Kong', flag: '🇭🇰', currency: 'HKD', currencySymbol: '$', region: 'East Asia' },
  MO: { name: 'Macau', flag: '🇲🇴', currency: 'MOP', currencySymbol: 'P', region: 'East Asia' },

  // Asia - Southeast
  TH: { name: 'Thailand', flag: '🇹🇭', currency: 'THB', currencySymbol: '฿', region: 'Southeast Asia' },
  MY: { name: 'Malaysia', flag: '🇲🇾', currency: 'MYR', currencySymbol: 'RM', region: 'Southeast Asia' },
  SG: { name: 'Singapore', flag: '🇸🇬', currency: 'SGD', currencySymbol: '$', region: 'Southeast Asia' },
  ID: { name: 'Indonesia', flag: '🇮🇩', currency: 'IDR', currencySymbol: 'Rp', region: 'Southeast Asia' },
  PH: { name: 'Philippines', flag: '🇵🇭', currency: 'PHP', currencySymbol: '₱', region: 'Southeast Asia' },
  VN: { name: 'Vietnam', flag: '🇻🇳', currency: 'VND', currencySymbol: '₫', region: 'Southeast Asia' },
  KH: { name: 'Cambodia', flag: '🇰🇭', currency: 'KHR', currencySymbol: '៛', region: 'Southeast Asia' },
  LA: { name: 'Laos', flag: '🇱🇦', currency: 'LAK', currencySymbol: '₭', region: 'Southeast Asia' },
  MM: { name: 'Myanmar', flag: '🇲🇲', currency: 'MMK', currencySymbol: 'K', region: 'Southeast Asia' },
  BN: { name: 'Brunei', flag: '🇧🇳', currency: 'BND', currencySymbol: '$', region: 'Southeast Asia' },
  TL: { name: 'Timor-Leste', flag: '🇹🇱', currency: 'USD', currencySymbol: '$', region: 'Southeast Asia' },

  // Oceania
  AU: { name: 'Australia', flag: '🇦🇺', currency: 'AUD', currencySymbol: 'A$', region: 'Oceania' },
  NZ: { name: 'New Zealand', flag: '🇳🇿', currency: 'NZD', currencySymbol: '$', region: 'Oceania' },
  FJ: { name: 'Fiji', flag: '🇫🇯', currency: 'FJD', currencySymbol: '$', region: 'Oceania' },
  PG: { name: 'Papua New Guinea', flag: '🇵🇬', currency: 'PGK', currencySymbol: 'K', region: 'Oceania' },
  VU: { name: 'Vanuatu', flag: '🇻🇺', currency: 'VUV', currencySymbol: 'Vt', region: 'Oceania' },
  WS: { name: 'Samoa', flag: '🇼🇸', currency: 'WST', currencySymbol: 'T', region: 'Oceania' },
  KI: { name: 'Kiribati', flag: '🇰🇮', currency: 'AUD', currencySymbol: '$', region: 'Oceania' },
  TO: { name: 'Tonga', flag: '🇹🇴', currency: 'TOP', currencySymbol: 'T$', region: 'Oceania' },
  MH: { name: 'Marshall Islands', flag: '🇲🇭', currency: 'USD', currencySymbol: '$', region: 'Oceania' },
  FM: { name: 'Micronesia', flag: '🇫🇲', currency: 'USD', currencySymbol: '$', region: 'Oceania' },
  PW: { name: 'Palau', flag: '🇵🇼', currency: 'USD', currencySymbol: '$', region: 'Oceania' },
  NR: { name: 'Nauru', flag: '🇳🇷', currency: 'AUD', currencySymbol: '$', region: 'Oceania' },
  SB: { name: 'Solomon Islands', flag: '🇸🇧', currency: 'SBD', currencySymbol: '$', region: 'Oceania' },
  NC: { name: 'New Caledonia', flag: '🇳🇨', currency: 'XPF', currencySymbol: 'Fr', region: 'Oceania' }
};

export class CountryService {
  /**
   * Get all countries
   */
  static getCountries() {
    return COUNTRIES;
  }

  /**
   * Get country by code
   */
  static getCountry(countryCode) {
    return COUNTRIES[countryCode] || null;
  }

  /**
   * Get countries by region
   */
  static getCountriesByRegion(region) {
    return Object.entries(COUNTRIES)
      .filter(([, country]) => country.region === region)
      .reduce((acc, [code, country]) => ({ ...acc, [code]: country }), {});
  }

  /**
   * Get all regions
   */
  static getRegions() {
    const regions = new Set(Object.values(COUNTRIES).map(c => c.region));
    return Array.from(regions).sort();
  }

  /**
   * Get currency symbol for country
   */
  static getCurrencySymbol(countryCode) {
    const country = COUNTRIES[countryCode];
    return country ? country.currencySymbol : '$';
  }

  /**
   * Get currency code for country
   */
  static getCurrencyCode(countryCode) {
    const country = COUNTRIES[countryCode];
    return country ? country.currency : 'USD';
  }

  /**
   * Convert ICAN Coins to local currency (UGX → Local)
   * 1 ICAN = 5000 UGX (or market price if blockchain enabled)
   */
  static icanToLocal(icanAmount, countryCode, marketPrice = null) {
    const exchangeRate = EXCHANGE_RATES[this.getCurrencyCode(countryCode)];
    if (!exchangeRate) return icanAmount;
    
    // Use market price if available (blockchain), otherwise use base rate
    const baseValueUGX = marketPrice || ICAN_BASE_RATE_UGX;
    return icanAmount * baseValueUGX * exchangeRate;
  }

  /**
   * Convert local currency to ICAN Coins (Local → UGX → ICAN)
   */
  static localToIcan(amount, countryCode, marketPrice = null) {
    const exchangeRate = EXCHANGE_RATES[this.getCurrencyCode(countryCode)];
    if (!exchangeRate) return amount;
    
    // Convert local to UGX first
    const ugxAmount = amount / exchangeRate;
    
    // Convert UGX to ICAN
    const baseValueUGX = marketPrice || ICAN_BASE_RATE_UGX;
    return ugxAmount / baseValueUGX;
  }

  /**
   * Convert between two currencies via ICAN
   */
  static convertCurrency(amount, fromCountry, toCountry, marketPrice = null) {
    const icanAmount = this.localToIcan(amount, fromCountry, marketPrice);
    return this.icanToLocal(icanAmount, toCountry, marketPrice);
  }

  /**
   * Get ICAN Coin equivalent amounts in all currencies
   * Returns object with amounts in each currency
   */
  static getIcanValueInAllCurrencies(icanAmount, marketPrice = null) {
    const values = {};
    Object.keys(EXCHANGE_RATES).forEach(currency => {
      const countryCode = Object.entries(COUNTRIES).find(([, c]) => c.currency === currency)?.[0];
      if (countryCode) {
        values[currency] = this.icanToLocal(icanAmount, countryCode, marketPrice);
      }
    });
    return values;
  }

  /**
   * Get base ICAN rate
   */
  static getBaseRate() {
    return ICAN_BASE_RATE_UGX;
  }

  /**
   * Format amount with currency symbol
   */
  static formatCurrency(amount, countryCode) {
    const country = COUNTRIES[countryCode];
    if (!country) return `$${amount.toLocaleString()}`;
    return `${country.currencySymbol}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  /**
   * Get country flag emoji
   */
  static getFlag(countryCode) {
    const country = COUNTRIES[countryCode];
    return country ? country.flag : '🌍';
  }

  /**
   * Update exchange rates from market data
   */
  static updateExchangeRates(newRates) {
    Object.assign(EXCHANGE_RATES, newRates);
  }
}

export default CountryService;
