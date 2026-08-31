import { countries, continents } from 'countries-list'

/**
 * The geographic knowledge base, sourced from the maintained `countries-list`
 * library (every country + a direct country→continent link) rather than a
 * hand-kept list. On top of it we add:
 *   - each country's native name as an alias (folds many local spellings), and
 *   - a small RECONCILE map for common English forms + the atlas's own
 *     abbreviations (e.g. "Dem. Rep. Congo", "USA", "Turkey" → Türkiye),
 * so data values, request phrases, and the map geometry all resolve to one
 * canonical country. US states aren't in any country library (they're a fixed
 * set of 50), so they stay as a small inline table.
 */

/** Normalize a name for matching: lowercase, strip accents/punctuation/hyphens. */
export function normName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining accents
    .replace(/-/g, ' ')
    .replace(/["'`.,]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Common English forms + atlas abbreviations, keyed by the library's canonical
// (normalized) country name → extra aliases that should resolve to it.
const RECONCILE: Record<string, string[]> = {
  'united states': ['usa', 'us', 'united states of america', 'america'],
  'united kingdom': ['uk', 'great britain', 'britain', 'england'],
  turkiye: ['turkey'],
  czechia: ['czech republic'],
  myanmar: ['burma'],
  russia: ['russian federation'],
  'democratic republic of the congo': ['dr congo', 'drc', 'dem rep congo', 'congo kinshasa'],
  'republic of the congo': ['congo', 'congo brazzaville'],
  'bosnia and herzegovina': ['bosnia', 'bosnia and herz'],
  'north macedonia': ['macedonia'],
  'south korea': ['korea', 'republic of korea'],
  'north korea': ['dprk'],
  'united arab emirates': ['uae'],
  eswatini: ['swaziland'],
  'cabo verde': ['cape verde'],
  'east timor': ['timor leste'],
  'south sudan': ['s sudan'],
  'central african republic': ['central african rep'],
  'dominican republic': ['dominican rep'],
  'solomon islands': ['solomon is'],
  'equatorial guinea': ['eq guinea'],
  'western sahara': ['w sahara'],
  bahamas: ['the bahamas'],
  gambia: ['the gambia'],
}

const ALIAS_TO_CANONICAL = new Map<string, string>() // normalized name/alias → canonical
const COUNTRY_CONTINENT: Record<string, string> = {} // canonical → continent

for (const country of Object.values(countries)) {
  if (country.continent === 'AN') continue // skip Antarctica
  const canonical = normName(country.name)
  COUNTRY_CONTINENT[canonical] = continents[country.continent]
  ALIAS_TO_CANONICAL.set(canonical, canonical)
  if (country.native) ALIAS_TO_CANONICAL.set(normName(country.native), canonical)
}
for (const [canonical, aliases] of Object.entries(RECONCILE)) {
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(normName(alias), canonical)
}

/** Set of canonical country names (for "does this value look like a country?"). */
export const COUNTRY_SET = new Set(Object.keys(COUNTRY_CONTINENT))

/** Normalized alias → canonical country (aliases only; excludes the self-maps). */
export const COUNTRY_ALIASES: Record<string, string> = {}
for (const [alias, canonical] of ALIAS_TO_CANONICAL) {
  if (alias !== canonical) COUNTRY_ALIASES[alias] = canonical
}

export { COUNTRY_CONTINENT }

/** Canonicalize a country name (folds aliases + the atlas's own spellings). */
export function canonicalCountry(name: string): string {
  const n = normName(name)
  return ALIAS_TO_CANONICAL.get(n) ?? n.replace(/ of america$/, '')
}

// ── Continents ────────────────────────────────────────────────────────────────
//
// Datasets disagree about how to slice the world: `countries-list` splits the
// Americas into North and South, while plenty of real data (including this repo's
// world_population.json) uses the single UN region "Americas". Both are legitimate,
// so both are canonical keys here and each resolves to its own set of member
// countries — "Americas" simply covers the union. The map joins through those
// member countries, so a dataset never has to match our vocabulary.

/** Continent (or UN region) → the canonical countries it contains. */
const CONTINENT_MEMBERS: Record<string, Set<string>> = {}

const addMember = (continent: string, country: string) => {
  ;(CONTINENT_MEMBERS[continent] ??= new Set()).add(country)
}

for (const [country, continent] of Object.entries(COUNTRY_CONTINENT)) {
  const key = normName(continent)
  addMember(key, country)
  // Umbrella regions: a row labelled "Americas" covers both American continents.
  if (key === 'north america' || key === 'south america') addMember('americas', country)
}

/** Extra spellings that resolve to a canonical continent key. */
const CONTINENT_ALIAS: Record<string, string> = {
  america: 'americas',
  'the americas': 'americas',
  australasia: 'oceania',
  'australia and oceania': 'oceania',
  'n america': 'north america',
  'northern america': 'north america',
  's america': 'south america',
  'southern america': 'south america',
  'latin america': 'south america',
}

/** Canonical continent keys (normalized), including the "Americas" umbrella. */
export const CONTINENT_SET = new Set(Object.keys(CONTINENT_MEMBERS))

/** Canonicalize a continent/region name, or null when it isn't one. */
export function canonicalContinent(value: string): string | null {
  const n = normName(value)
  if (CONTINENT_SET.has(n)) return n
  const alias = CONTINENT_ALIAS[n]
  return alias && CONTINENT_SET.has(alias) ? alias : null
}

/** The canonical countries making up a continent key (empty set if unknown). */
export function continentCountries(continentKey: string): Set<string> {
  return CONTINENT_MEMBERS[continentKey] ?? new Set()
}

// ── US states (fixed set of 50 + DC; not in any country library) ──
const US_STATE_TABLE: [string, string][] = [
  ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'], ['California', 'CA'],
  ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'], ['Florida', 'FL'], ['Georgia', 'GA'],
  ['Hawaii', 'HI'], ['Idaho', 'ID'], ['Illinois', 'IL'], ['Indiana', 'IN'], ['Iowa', 'IA'],
  ['Kansas', 'KS'], ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'],
  ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'], ['Mississippi', 'MS'], ['Missouri', 'MO'],
  ['Montana', 'MT'], ['Nebraska', 'NE'], ['Nevada', 'NV'], ['New Hampshire', 'NH'], ['New Jersey', 'NJ'],
  ['New Mexico', 'NM'], ['New York', 'NY'], ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'],
  ['Oklahoma', 'OK'], ['Oregon', 'OR'], ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'], ['South Carolina', 'SC'],
  ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'], ['Vermont', 'VT'],
  ['Virginia', 'VA'], ['Washington', 'WA'], ['West Virginia', 'WV'], ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
  ['District of Columbia', 'DC'],
]

const US_STATES: Record<string, string> = {} // normalized name/abbr → canonical (lowercase) state
for (const [name, abbr] of US_STATE_TABLE) {
  const key = normName(name)
  US_STATES[key] = key
  US_STATES[normName(abbr)] = key
}

/** Canonical US state name for a data value, or null if it isn't a US state. */
export function canonicalState(value: string): string | null {
  return US_STATES[normName(value)] ?? null
}
