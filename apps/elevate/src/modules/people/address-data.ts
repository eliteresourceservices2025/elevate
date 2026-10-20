import psgc from "./psgc-ph.json";

// Pure data and helpers for addresses. No server-only import: the form, the validators and the signing merge fields all use it.
// The Philippine lists come from PSGC (see scripts/build-psgc.mts) and are committed, never fetched at runtime.

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["AS", "American Samoa"], ["GU", "Guam"], ["MP", "Northern Mariana Islands"], ["PR", "Puerto Rico"], ["VI", "U.S. Virgin Islands"],
].map(([code, name]) => ({ code, name }));

const PH_CITIES_BY_PROVINCE: Readonly<Record<string, readonly string[]>> = psgc;
export const PH_PROVINCES: readonly string[] = Object.keys(PH_CITIES_BY_PROVINCE);
const PH_ALL_CITIES: readonly string[] = [...new Set(Object.values(PH_CITIES_BY_PROVINCE).flat())].sort((a, b) => a.localeCompare(b));

const US_CODES = new Set(US_STATES.map((s) => s.code));
const PH_PROVINCE_SET = new Set(PH_PROVINCES);
const PH_CITY_SET = new Set(PH_ALL_CITIES);

/** Cities and municipalities of a province; every one when the province is not in the list (an older free-text value). */
export function phCitiesFor(province: string | undefined): readonly string[] {
  // eslint-disable-next-line security/detect-object-injection -- guarded by the Set check
  return province && PH_PROVINCE_SET.has(province) ? PH_CITIES_BY_PROVINCE[province] : PH_ALL_CITIES;
}

// ISO 3166-1 alpha-2. Names come from Intl.DisplayNames so there is no second list to keep in step.
const COUNTRY_CODES =
  "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(" ");

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Country choices for the picker: the two home countries first, then the rest by name. */
export const COUNTRY_OPTIONS: readonly { code: string; name: string }[] = [
  ...["PH", "US"].map((code) => ({ code, name: countryName(code) })),
  ...COUNTRY_CODES.filter((c) => c !== "PH" && c !== "US")
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

export const US_ZIP = /^\d{5}(-\d{4})?$/; // eslint-disable-line security/detect-unsafe-regex -- fixed lengths, no backtracking
export const PH_POSTAL = /^\d{4}$/;

export type AddressParts = {
  addressLine?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

/** Values a person already has saved. An unchanged one is accepted even if it is not in the lists. */
export type LegacyAddress = Pick<AddressParts, "country" | "city" | "province" | "postalCode">;

export type AddressIssue = { field: "country" | "city" | "province" | "postalCode"; message: string };

const clean = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Country-aware address checks. Philippines and United States are strict; other countries are free text.
 * A value equal to the one already saved is let through, so old free-text addresses never block saving something else.
 */
export function addressIssues(v: AddressParts, legacy?: LegacyAddress): AddressIssue[] {
  const country = clean(v.country) || clean(legacy?.country) || "PH";
  const issues: AddressIssue[] = [];
  const unchanged = (field: "city" | "province" | "postalCode") => {
    // eslint-disable-next-line security/detect-object-injection -- field is one of three literal keys
    const now = clean(v[field]);
    // eslint-disable-next-line security/detect-object-injection -- field is one of three literal keys
    return now !== "" && now === clean(legacy?.[field]) && (clean(v.country) === "" || clean(v.country) === clean(legacy?.country));
  };
  const province = clean(v.province);
  const city = clean(v.city);
  const postal = clean(v.postalCode);

  if (country === "US") {
    if (province && !US_CODES.has(province) && !unchanged("province")) issues.push({ field: "province", message: "Choose a US state" });
    if (postal && !US_ZIP.test(postal) && !unchanged("postalCode")) issues.push({ field: "postalCode", message: "Use a ZIP code like 85001 or 85001-1234" });
  } else if (country === "PH") {
    if (province && !PH_PROVINCE_SET.has(province) && !unchanged("province")) issues.push({ field: "province", message: "Choose a province from the list" });
    if (city && !unchanged("city")) {
      const known = PH_PROVINCE_SET.has(province) ? phCitiesFor(province).includes(city) : PH_CITY_SET.has(city);
      if (!known) issues.push({ field: "city", message: "Choose a city or municipality from the list" });
    }
    if (postal && !PH_POSTAL.test(postal) && !unchanged("postalCode")) issues.push({ field: "postalCode", message: "Use a 4-digit postal code" });
  }
  return issues;
}

/** Labels that change with the country. */
export function addressLabels(country: string | null | undefined) {
  if (country === "US") return { line: "Street address", lineHint: "Street, apartment or suite", city: "City", province: "State", postal: "ZIP code" };
  if (country === "PH") return { line: "Address", lineHint: "House or unit number, street, barangay", city: "City or municipality", province: "Province", postal: "Postal code" };
  return { line: "Address", lineHint: undefined, city: "City", province: "State or region", postal: "Postal code" };
}

/**
 * One-line address in the order each country writes it. Returns "" when there is nothing but a country,
 * because a country on its own is not an address.
 */
export function formatAddress(a: AddressParts): string {
  const line = clean(a.addressLine);
  const city = clean(a.city);
  const province = clean(a.province);
  const postal = clean(a.postalCode);
  if (!line && !city && !province && !postal) return "";
  const code = clean(a.country) || "PH";
  const region = [province, postal].filter(Boolean).join(" ");
  return [line, city, region, countryName(code)].filter(Boolean).join(", ");
}

/** The address fields of a form's starting values, as plain strings (the form types are loose because empty boxes become undefined). */
export function savedAddressOf(values: object | undefined): LegacyAddress {
  const v = (values ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line security/detect-object-injection -- k is a literal key from this function
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  return { country: str("country"), city: str("city"), province: str("province"), postalCode: str("postalCode") };
}
