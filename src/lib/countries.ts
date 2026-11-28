/**
 * Standardized ISO-2 / ISO-3 Country & Nationality catalog for Like Family PMS.
 * - Top 10 priority markets pinned in exact operational order for Da Nang hospitality.
 * - Full world list sorted A-Z by Vietnamese name.
 * - `normalizeCountryCode()` maps ISO-2, ISO-3 (Passport MRZ from Gemini Vision OCR),
 *   Vietnamese names (with/without diacritics), English names & common aliases -> ISO-2 code.
 */

export interface CountryOption {
  code: string; // ISO 3166-1 alpha-2 (e.g. 'CN')
  iso3: string; // ISO 3166-1 alpha-3 for Vietnam ASM portal / MRZ (e.g. 'CHN')
  nameVi: string;
  nameEn: string;
  priority?: number;
  aliases?: string[];
}

export const PRIORITY_COUNTRIES: CountryOption[] = [
  { code: 'CN', iso3: 'CHN', nameVi: 'Trung Quốc', nameEn: 'China', priority: 1, aliases: ['prc', 'peoples republic of china', 'chinese', 'tq'] },
  { code: 'RU', iso3: 'RUS', nameVi: 'Nga', nameEn: 'Russia', priority: 2, aliases: ['russian federation', 'russian', 'lien bang nga'] },
  { code: 'KR', iso3: 'KOR', nameVi: 'Hàn Quốc', nameEn: 'South Korea', priority: 3, aliases: ['korea', 'republic of korea', 'korean', 'rok', 'nam han'] },
  { code: 'VN', iso3: 'VNM', nameVi: 'Việt Nam', nameEn: 'Vietnam', priority: 4, aliases: ['viet nam', 'vietnamese'] },
  { code: 'KZ', iso3: 'KAZ', nameVi: 'Kazakhstan', nameEn: 'Kazakhstan', priority: 5, aliases: ['kazakh'] },
  { code: 'US', iso3: 'USA', nameVi: 'Mỹ', nameEn: 'United States', priority: 6, aliases: ['hoa ky', 'united states of america', 'america', 'american'] },
  { code: 'AU', iso3: 'AUS', nameVi: 'Úc', nameEn: 'Australia', priority: 7, aliases: ['australian', 'oz'] },
  { code: 'JP', iso3: 'JPN', nameVi: 'Nhật Bản', nameEn: 'Japan', priority: 8, aliases: ['japanese', 'nhat'] },
  { code: 'TW', iso3: 'TWN', nameVi: 'Đài Loan', nameEn: 'Taiwan', priority: 9, aliases: ['taiwanese', 'chinese taipei', 'roc'] },
  { code: 'HK', iso3: 'HKG', nameVi: 'Hồng Kông', nameEn: 'Hong Kong', priority: 10, aliases: ['hongkong', 'hk sar'] },
];

const OTHER_COUNTRIES_RAW: CountryOption[] = [
  { code: 'AF', iso3: 'AFG', nameVi: 'Afghanistan', nameEn: 'Afghanistan' },
  { code: 'EG', iso3: 'EGY', nameVi: 'Ai Cập', nameEn: 'Egypt' },
  { code: 'AL', iso3: 'ALB', nameVi: 'Albania', nameEn: 'Albania' },
  { code: 'DZ', iso3: 'DZA', nameVi: 'Algeria', nameEn: 'Algeria' },
  { code: 'AD', iso3: 'AND', nameVi: 'Andorra', nameEn: 'Andorra' },
  { code: 'AO', iso3: 'AGO', nameVi: 'Angola', nameEn: 'Angola' },
  { code: 'GB', iso3: 'GBR', nameVi: 'Anh', nameEn: 'United Kingdom', aliases: ['uk', 'great britain', 'britain', 'british', 'england', 'scotland', 'wales', 'vuong quoc anh'] },
  { code: 'AT', iso3: 'AUT', nameVi: 'Áo', nameEn: 'Austria', aliases: ['austrian'] },
  { code: 'SA', iso3: 'SAU', nameVi: 'Ả Rập Xê Út', nameEn: 'Saudi Arabia', aliases: ['saudi'] },
  { code: 'AR', iso3: 'ARG', nameVi: 'Argentina', nameEn: 'Argentina' },
  { code: 'AM', iso3: 'ARM', nameVi: 'Armenia', nameEn: 'Armenia' },
  { code: 'AZ', iso3: 'AZE', nameVi: 'Azerbaijan', nameEn: 'Azerbaijan' },
  { code: 'IN', iso3: 'IND', nameVi: 'Ấn Độ', nameEn: 'India', aliases: ['indian'] },
  { code: 'PL', iso3: 'POL', nameVi: 'Ba Lan', nameEn: 'Poland', aliases: ['polish'] },
  { code: 'BS', iso3: 'BHS', nameVi: 'Bahamas', nameEn: 'Bahamas' },
  { code: 'BH', iso3: 'BHR', nameVi: 'Bahrain', nameEn: 'Bahrain' },
  { code: 'BD', iso3: 'BGD', nameVi: 'Bangladesh', nameEn: 'Bangladesh' },
  { code: 'BY', iso3: 'BLR', nameVi: 'Belarus', nameEn: 'Belarus', aliases: ['belarusian'] },
  { code: 'BE', iso3: 'BEL', nameVi: 'Bỉ', nameEn: 'Belgium', aliases: ['belgian'] },
  { code: 'BO', iso3: 'BOL', nameVi: 'Bolivia', nameEn: 'Bolivia' },
  { code: 'BA', iso3: 'BIH', nameVi: 'Bosnia và Herzegovina', nameEn: 'Bosnia and Herzegovina' },
  { code: 'PT', iso3: 'PRT', nameVi: 'Bồ Đào Nha', nameEn: 'Portugal', aliases: ['portuguese'] },
  { code: 'BR', iso3: 'BRA', nameVi: 'Brazil', nameEn: 'Brazil', aliases: ['brazilian', 'bra-xin'] },
  { code: 'BN', iso3: 'BRN', nameVi: 'Brunei', nameEn: 'Brunei', aliases: ['brunei darussalam'] },
  { code: 'BG', iso3: 'BGR', nameVi: 'Bulgaria', nameEn: 'Bulgaria' },
  { code: 'AE', iso3: 'ARE', nameVi: 'Các Tiểu vương quốc Ả Rập Thống nhất', nameEn: 'United Arab Emirates', aliases: ['uae', 'dubai', 'abu dhabi'] },
  { code: 'CM', iso3: 'CMR', nameVi: 'Cameroon', nameEn: 'Cameroon' },
  { code: 'KH', iso3: 'KHM', nameVi: 'Campuchia', nameEn: 'Cambodia', aliases: ['cambodian'] },
  { code: 'CA', iso3: 'CAN', nameVi: 'Canada', nameEn: 'Canada', aliases: ['canadian'] },
  { code: 'CL', iso3: 'CHL', nameVi: 'Chile', nameEn: 'Chile' },
  { code: 'CO', iso3: 'COL', nameVi: 'Colombia', nameEn: 'Colombia' },
  { code: 'CR', iso3: 'CRI', nameVi: 'Costa Rica', nameEn: 'Costa Rica' },
  { code: 'HR', iso3: 'HRV', nameVi: 'Croatia', nameEn: 'Croatia' },
  { code: 'CU', iso3: 'CUB', nameVi: 'Cuba', nameEn: 'Cuba' },
  { code: 'DK', iso3: 'DNK', nameVi: 'Đan Mạch', nameEn: 'Denmark', aliases: ['danish'] },
  { code: 'TL', iso3: 'TLS', nameVi: 'Đông Timor', nameEn: 'Timor-Leste', aliases: ['east timor'] },
  { code: 'DE', iso3: 'DEU', nameVi: 'Đức', nameEn: 'Germany', aliases: ['german', 'deutschland', 'd<<', 'd'] },
  { code: 'EC', iso3: 'ECU', nameVi: 'Ecuador', nameEn: 'Ecuador' },
  { code: 'EE', iso3: 'EST', nameVi: 'Estonia', nameEn: 'Estonia' },
  { code: 'ET', iso3: 'ETH', nameVi: 'Ethiopia', nameEn: 'Ethiopia' },
  { code: 'FJ', iso3: 'FJI', nameVi: 'Fiji', nameEn: 'Fiji' },
  { code: 'GE', iso3: 'GEO', nameVi: 'Georgia', nameEn: 'Georgia', aliases: ['gruzia'] },
  { code: 'GH', iso3: 'GHA', nameVi: 'Ghana', nameEn: 'Ghana' },
  { code: 'NL', iso3: 'NLD', nameVi: 'Hà Lan', nameEn: 'Netherlands', aliases: ['holland', 'dutch'] },
  { code: 'HU', iso3: 'HUN', nameVi: 'Hungary', nameEn: 'Hungary', aliases: ['hungarian'] },
  { code: 'GR', iso3: 'GRC', nameVi: 'Hy Lạp', nameEn: 'Greece', aliases: ['greek'] },
  { code: 'IS', iso3: 'ISL', nameVi: 'Iceland', nameEn: 'Iceland' },
  { code: 'ID', iso3: 'IDN', nameVi: 'Indonesia', nameEn: 'Indonesia', aliases: ['indonesian'] },
  { code: 'IR', iso3: 'IRN', nameVi: 'Iran', nameEn: 'Iran' },
  { code: 'IQ', iso3: 'IRQ', nameVi: 'Iraq', nameEn: 'Iraq' },
  { code: 'IE', iso3: 'IRL', nameVi: 'Ireland', nameEn: 'Ireland', aliases: ['irish', 'ai len'] },
  { code: 'IL', iso3: 'ISR', nameVi: 'Israel', nameEn: 'Israel', aliases: ['israeli'] },
  { code: 'JM', iso3: 'JAM', nameVi: 'Jamaica', nameEn: 'Jamaica' },
  { code: 'JO', iso3: 'JOR', nameVi: 'Jordan', nameEn: 'Jordan' },
  { code: 'KE', iso3: 'KEN', nameVi: 'Kenya', nameEn: 'Kenya' },
  { code: 'KW', iso3: 'KWT', nameVi: 'Kuwait', nameEn: 'Kuwait' },
  { code: 'KG', iso3: 'KGZ', nameVi: 'Kyrgyzstan', nameEn: 'Kyrgyzstan' },
  { code: 'LA', iso3: 'LAO', nameVi: 'Lào', nameEn: 'Laos', aliases: ['lao', 'lao pdr'] },
  { code: 'LV', iso3: 'LVA', nameVi: 'Latvia', nameEn: 'Latvia' },
  { code: 'LB', iso3: 'LBN', nameVi: 'Lebanon', nameEn: 'Lebanon', aliases: ['li bang'] },
  { code: 'LT', iso3: 'LTU', nameVi: 'Litva', nameEn: 'Lithuania', aliases: ['lithuanian'] },
  { code: 'LU', iso3: 'LUX', nameVi: 'Luxembourg', nameEn: 'Luxembourg' },
  { code: 'MO', iso3: 'MAC', nameVi: 'Ma Cao', nameEn: 'Macau', aliases: ['macao'] },
  { code: 'MY', iso3: 'MYS', nameVi: 'Malaysia', nameEn: 'Malaysia', aliases: ['malaysian', 'ma lai'] },
  { code: 'MV', iso3: 'MDV', nameVi: 'Maldives', nameEn: 'Maldives' },
  { code: 'MT', iso3: 'MLT', nameVi: 'Malta', nameEn: 'Malta' },
  { code: 'MA', iso3: 'MAR', nameVi: 'Ma-rốc', nameEn: 'Morocco', aliases: ['moroccan'] },
  { code: 'MX', iso3: 'MEX', nameVi: 'Mexico', nameEn: 'Mexico', aliases: ['mexican', 'me hi co'] },
  { code: 'MD', iso3: 'MDA', nameVi: 'Moldova', nameEn: 'Moldova' },
  { code: 'MC', iso3: 'MCO', nameVi: 'Monaco', nameEn: 'Monaco' },
  { code: 'MN', iso3: 'MNG', nameVi: 'Mông Cổ', nameEn: 'Mongolia', aliases: ['mongolian'] },
  { code: 'ME', iso3: 'MNE', nameVi: 'Montenegro', nameEn: 'Montenegro' },
  { code: 'MM', iso3: 'MMR', nameVi: 'Myanmar', nameEn: 'Myanmar', aliases: ['burma'] },
  { code: 'ZA', iso3: 'ZAF', nameVi: 'Nam Phi', nameEn: 'South Africa', aliases: ['south african'] },
  { code: 'NO', iso3: 'NOR', nameVi: 'Na Uy', nameEn: 'Norway', aliases: ['norwegian'] },
  { code: 'NP', iso3: 'NPL', nameVi: 'Nepal', nameEn: 'Nepal', aliases: ['nepalese'] },
  { code: 'NZ', iso3: 'NZL', nameVi: 'New Zealand', nameEn: 'New Zealand', aliases: ['kiwi'] },
  { code: 'NG', iso3: 'NGA', nameVi: 'Nigeria', nameEn: 'Nigeria' },
  { code: 'OM', iso3: 'OMN', nameVi: 'Oman', nameEn: 'Oman' },
  { code: 'PK', iso3: 'PAK', nameVi: 'Pakistan', nameEn: 'Pakistan' },
  { code: 'PA', iso3: 'PAN', nameVi: 'Panama', nameEn: 'Panama' },
  { code: 'PY', iso3: 'PRY', nameVi: 'Paraguay', nameEn: 'Paraguay' },
  { code: 'PE', iso3: 'PER', nameVi: 'Peru', nameEn: 'Peru' },
  { code: 'FI', iso3: 'FIN', nameVi: 'Phần Lan', nameEn: 'Finland', aliases: ['finnish'] },
  { code: 'FR', iso3: 'FRA', nameVi: 'Pháp', nameEn: 'France', aliases: ['french'] },
  { code: 'PH', iso3: 'PHL', nameVi: 'Philippines', nameEn: 'Philippines', aliases: ['filipino', 'philippine'] },
  { code: 'QA', iso3: 'QAT', nameVi: 'Qatar', nameEn: 'Qatar' },
  { code: 'RO', iso3: 'ROU', nameVi: 'Romania', nameEn: 'Romania', aliases: ['romanian', 'ru ma ni'] },
  { code: 'CZ', iso3: 'CZE', nameVi: 'Séc', nameEn: 'Czech Republic', aliases: ['czechia', 'czech', 'cong hoa sec'] },
  { code: 'RS', iso3: 'SRB', nameVi: 'Serbia', nameEn: 'Serbia' },
  { code: 'SG', iso3: 'SGP', nameVi: 'Singapore', nameEn: 'Singapore', aliases: ['singaporean'] },
  { code: 'CY', iso3: 'CYP', nameVi: 'Síp', nameEn: 'Cyprus' },
  { code: 'SK', iso3: 'SVK', nameVi: 'Slovakia', nameEn: 'Slovakia' },
  { code: 'SI', iso3: 'SVN', nameVi: 'Slovenia', nameEn: 'Slovenia' },
  { code: 'LK', iso3: 'LKA', nameVi: 'Sri Lanka', nameEn: 'Sri Lanka' },
  { code: 'TJ', iso3: 'TJK', nameVi: 'Tajikistan', nameEn: 'Tajikistan' },
  { code: 'TZ', iso3: 'TZA', nameVi: 'Tanzania', nameEn: 'Tanzania' },
  { code: 'ES', iso3: 'ESP', nameVi: 'Tây Ban Nha', nameEn: 'Spain', aliases: ['spanish'] },
  { code: 'TH', iso3: 'THA', nameVi: 'Thái Lan', nameEn: 'Thailand', aliases: ['thai'] },
  { code: 'TR', iso3: 'TUR', nameVi: 'Thổ Nhĩ Kỳ', nameEn: 'Turkey', aliases: ['turkiye', 'turkish'] },
  { code: 'SE', iso3: 'SWE', nameVi: 'Thụy Điển', nameEn: 'Sweden', aliases: ['swedish'] },
  { code: 'CH', iso3: 'CHE', nameVi: 'Thụy Sĩ', nameEn: 'Switzerland', aliases: ['swiss'] },
  { code: 'KP', iso3: 'PRK', nameVi: 'Triều Tiên', nameEn: 'North Korea', aliases: ['dprk'] },
  { code: 'TN', iso3: 'TUN', nameVi: 'Tunisia', nameEn: 'Tunisia' },
  { code: 'TM', iso3: 'TKM', nameVi: 'Turkmenistan', nameEn: 'Turkmenistan' },
  { code: 'UA', iso3: 'UKR', nameVi: 'Ukraine', nameEn: 'Ukraine', aliases: ['ukrainian', 'u crai na'] },
  { code: 'UY', iso3: 'URY', nameVi: 'Uruguay', nameEn: 'Uruguay' },
  { code: 'UZ', iso3: 'UZB', nameVi: 'Uzbekistan', nameEn: 'Uzbekistan', aliases: ['uzbek'] },
  { code: 'VE', iso3: 'VEN', nameVi: 'Venezuela', nameEn: 'Venezuela' },
  { code: 'IT', iso3: 'ITA', nameVi: 'Ý', nameEn: 'Italy', aliases: ['italian', 'i ta li a'] },
];

export const OTHER_COUNTRIES: CountryOption[] = [...OTHER_COUNTRIES_RAW].sort((a, b) =>
  a.nameVi.localeCompare(b.nameVi, 'vi')
);

export const ALL_COUNTRIES: CountryOption[] = [...PRIORITY_COUNTRIES, ...OTHER_COUNTRIES];

function stripDiacriticsLower(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

const LOOKUP_BY_KEY = new Map<string, CountryOption>();
for (const c of ALL_COUNTRIES) {
  LOOKUP_BY_KEY.set(c.code.toLowerCase(), c);
  LOOKUP_BY_KEY.set(c.iso3.toLowerCase(), c);
  LOOKUP_BY_KEY.set(stripDiacriticsLower(c.nameVi), c);
  LOOKUP_BY_KEY.set(stripDiacriticsLower(c.nameEn), c);
  for (const alias of c.aliases || []) {
    LOOKUP_BY_KEY.set(stripDiacriticsLower(alias), c);
  }
}

/**
 * Normalizes any raw nationality value (ISO-2, ISO-3 MRZ from Passport OCR,
 * Vietnamese name, English name, or common alias) to canonical ISO-2 code (e.g. 'CN', 'RU', 'KR', 'VN').
 * Falls back to trimmed raw value if unrecognized (preserving custom/stateless entries).
 */
export function normalizeCountryCode(raw: string | undefined | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  // Direct lookup (handles 'CN', 'CHN', 'China', 'Trung Quốc', 'Việt Nam', etc.)
  const direct = LOOKUP_BY_KEY.get(stripDiacriticsLower(trimmed));
  if (direct) return direct.code;

  // Handle formatted labels like "[CN] Trung Quốc (China)" or "CN · Trung Quốc" or "CN - China"
  const bracketMatch = trimmed.match(/^\[?([A-Za-z]{2,3})\]?(?:\s*[-·—:]|\s+\()/);
  if (bracketMatch) {
    const fromPrefix = LOOKUP_BY_KEY.get(bracketMatch[1].toLowerCase());
    if (fromPrefix) return fromPrefix.code;
  }

  // Handle MRZ trailing chevrons like "D<<" or "CHN<"
  const mrzClean = trimmed.replace(/<+$/g, '').trim();
  if (mrzClean && mrzClean !== trimmed) {
    const fromMrz = LOOKUP_BY_KEY.get(stripDiacriticsLower(mrzClean));
    if (fromMrz) return fromMrz.code;
  }

  return trimmed;
}

export function findCountryByValue(raw: string | undefined | null): CountryOption | undefined {
  const code = normalizeCountryCode(raw);
  if (!code) return undefined;
  return LOOKUP_BY_KEY.get(stripDiacriticsLower(code));
}

/** Full display used in CountrySelect trigger & detail chips: "[CN] Trung Quốc (China)" */
export function formatCountryDisplay(raw: string | undefined | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const found = findCountryByValue(trimmed);
  if (!found) return trimmed;
  return found.nameVi.toLowerCase() === found.nameEn.toLowerCase()
    ? `[${found.code}] ${found.nameVi}`
    : `[${found.code}] ${found.nameVi} (${found.nameEn})`;
}

/** Compact badge used in ASM & Guest tables: "CN · Trung Quốc" */
export function formatCountryBadge(raw: string | undefined | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const found = findCountryByValue(trimmed);
  if (!found) return trimmed;
  return `${found.code} · ${found.nameVi}`;
}

/** Canonical ISO-2 & ISO-3 info for Vietnam ASM Excel export */
export function resolveCountryForAsm(raw: string | undefined | null): {
  code: string;
  iso3: string;
  nameVi: string;
  nameEn: string;
} {
  const trimmed = String(raw || '').trim();
  const found = findCountryByValue(trimmed);
  if (found) {
    return { code: found.code, iso3: found.iso3, nameVi: found.nameVi, nameEn: found.nameEn };
  }
  const fallback = normalizeCountryCode(trimmed);
  return { code: fallback, iso3: fallback.length === 3 ? fallback.toUpperCase() : '', nameVi: fallback, nameEn: '' };
}

/** Diacritic-insensitive search splitting Priority vs All Countries */
export function searchCountries(query: string): {
  priority: CountryOption[];
  others: CountryOption[];
} {
  const q = stripDiacriticsLower(query);
  if (!q) {
    return { priority: PRIORITY_COUNTRIES, others: OTHER_COUNTRIES };
  }
  const matches = (c: CountryOption) => {
    if (c.code.toLowerCase().includes(q)) return true;
    if (c.iso3.toLowerCase().includes(q)) return true;
    if (stripDiacriticsLower(c.nameVi).includes(q)) return true;
    if (stripDiacriticsLower(c.nameEn).includes(q)) return true;
    if ((c.aliases || []).some((a) => stripDiacriticsLower(a).includes(q))) return true;
    return false;
  };
  return {
    priority: PRIORITY_COUNTRIES.filter(matches),
    others: OTHER_COUNTRIES.filter(matches),
  };
}
