// Industry definitions with keyword templates.
// {city} is replaced at runtime with the location's city.

export interface IndustryDef {
  label: string;
  group: string;
  // First keyword is the "primary" one used for audit ranking checks.
  keywords: string[];
}

export const INDUSTRY_MAP: Record<string, IndustryDef> = {
  // ── Home Services ──────────────────────────────────────────────────────────
  'Plumbing': {
    label: 'Plumbing', group: 'Home Services',
    keywords: ['plumber near me', 'plumber in {city}', 'emergency plumber', 'drain cleaning {city}', 'water heater repair {city}'],
  },
  'HVAC': {
    label: 'HVAC', group: 'Home Services',
    keywords: ['hvac near me', 'air conditioning repair {city}', 'furnace repair {city}', 'hvac company {city}'],
  },
  'Electrical': {
    label: 'Electrical', group: 'Home Services',
    keywords: ['electrician near me', 'electrician {city}', 'electrical repair {city}'],
  },
  'Roofing': {
    label: 'Roofing', group: 'Home Services',
    keywords: ['roofer near me', 'roof repair {city}', 'roofing company {city}'],
  },
  'Landscaping': {
    label: 'Landscaping', group: 'Home Services',
    keywords: ['landscaping near me', 'lawn care {city}', 'landscaping company {city}'],
  },
  'Cleaning': {
    label: 'Cleaning', group: 'Home Services',
    keywords: ['house cleaning near me', 'cleaning service {city}', 'maid service {city}'],
  },
  'Pest Control': {
    label: 'Pest Control', group: 'Home Services',
    keywords: ['pest control near me', 'exterminator {city}', 'pest control {city}'],
  },
  'Painting': {
    label: 'Painting', group: 'Home Services',
    keywords: ['painter near me', 'painting contractor {city}', 'house painter {city}'],
  },
  'Flooring': {
    label: 'Flooring', group: 'Home Services',
    keywords: ['flooring near me', 'flooring company {city}', 'hardwood floor installation {city}'],
  },
  'Moving': {
    label: 'Moving', group: 'Home Services',
    keywords: ['moving company near me', 'movers {city}', 'local movers {city}'],
  },
  'General Contractor': {
    label: 'General Contractor', group: 'Home Services',
    keywords: ['contractor near me', 'general contractor {city}', 'home renovation {city}'],
  },
  // ── Health & Fitness ───────────────────────────────────────────────────────
  'Personal Training': {
    label: 'Personal Training', group: 'Health & Fitness',
    keywords: ['personal trainer near me', 'personal trainer in {city}', 'fitness trainer {city}', 'private trainer {city}'],
  },
  'Gym / Fitness Studio': {
    label: 'Gym / Fitness Studio', group: 'Health & Fitness',
    keywords: ['gym near me', 'fitness studio {city}', 'crossfit {city}', 'yoga studio {city}'],
  },
  'Physical Therapy': {
    label: 'Physical Therapy', group: 'Health & Fitness',
    keywords: ['physical therapy near me', 'physical therapist {city}', 'pt clinic {city}'],
  },
  'Chiropractic': {
    label: 'Chiropractic', group: 'Health & Fitness',
    keywords: ['chiropractor near me', 'chiropractor {city}', 'back pain treatment {city}'],
  },
  'Massage Therapy': {
    label: 'Massage Therapy', group: 'Health & Fitness',
    keywords: ['massage near me', 'massage therapist {city}', 'deep tissue massage {city}'],
  },
  'Dental': {
    label: 'Dental', group: 'Health & Fitness',
    keywords: ['dentist near me', 'dentist {city}', 'dental office {city}', 'family dentist {city}'],
  },
  // ── Legal ──────────────────────────────────────────────────────────────────
  'Law Firm': {
    label: 'Law Firm', group: 'Legal',
    keywords: ['lawyer near me', 'attorney {city}', 'law firm {city}'],
  },
  'Family Law': {
    label: 'Family Law', group: 'Legal',
    keywords: ['family lawyer near me', 'divorce attorney {city}', 'child custody lawyer {city}'],
  },
  'Personal Injury': {
    label: 'Personal Injury', group: 'Legal',
    keywords: ['personal injury lawyer near me', 'accident attorney {city}', 'injury law firm {city}'],
  },
  // ── Food & Beverage ────────────────────────────────────────────────────────
  'Restaurant': {
    label: 'Restaurant', group: 'Food & Beverage',
    keywords: ['restaurant near me', 'restaurants in {city}', 'best restaurant {city}'],
  },
  'Coffee Shop': {
    label: 'Coffee Shop', group: 'Food & Beverage',
    keywords: ['coffee shop near me', 'cafe {city}', 'coffee near me'],
  },
  'Food Truck': {
    label: 'Food Truck', group: 'Food & Beverage',
    keywords: ['food truck near me', 'food truck {city}'],
  },
  'Bakery': {
    label: 'Bakery', group: 'Food & Beverage',
    keywords: ['bakery near me', 'bakery {city}', 'custom cakes {city}'],
  },
  // ── Beauty & Personal Care ─────────────────────────────────────────────────
  'Hair Salon': {
    label: 'Hair Salon', group: 'Beauty & Personal Care',
    keywords: ['hair salon near me', 'hair salon {city}', 'haircut {city}'],
  },
  'Barbershop': {
    label: 'Barbershop', group: 'Beauty & Personal Care',
    keywords: ['barber near me', 'barbershop {city}', 'haircut near me'],
  },
  'Nail Salon': {
    label: 'Nail Salon', group: 'Beauty & Personal Care',
    keywords: ['nail salon near me', 'nail salon {city}', 'manicure {city}'],
  },
  'Med Spa': {
    label: 'Med Spa', group: 'Beauty & Personal Care',
    keywords: ['med spa near me', 'medical spa {city}', 'botox {city}'],
  },
  // ── Auto ───────────────────────────────────────────────────────────────────
  'Auto Repair': {
    label: 'Auto Repair', group: 'Automotive',
    keywords: ['auto repair near me', 'mechanic {city}', 'car repair {city}'],
  },
  'Auto Detailing': {
    label: 'Auto Detailing', group: 'Automotive',
    keywords: ['auto detailing near me', 'car detailing {city}', 'mobile detailing {city}'],
  },
  // ── Professional Services ──────────────────────────────────────────────────
  'Accounting / CPA': {
    label: 'Accounting / CPA', group: 'Professional Services',
    keywords: ['accountant near me', 'cpa {city}', 'tax preparation {city}'],
  },
  'Real Estate': {
    label: 'Real Estate', group: 'Professional Services',
    keywords: ['realtor near me', 'real estate agent {city}', 'homes for sale {city}'],
  },
  'Insurance': {
    label: 'Insurance', group: 'Professional Services',
    keywords: ['insurance agent near me', 'insurance company {city}'],
  },
  'Veterinary': {
    label: 'Veterinary', group: 'Professional Services',
    keywords: ['vet near me', 'veterinarian {city}', 'animal hospital {city}'],
  },
  'Photography': {
    label: 'Photography', group: 'Professional Services',
    keywords: ['photographer near me', 'photography {city}', 'wedding photographer {city}'],
  },
  'Tutoring': {
    label: 'Tutoring', group: 'Professional Services',
    keywords: ['tutor near me', 'tutoring {city}', 'private tutor {city}'],
  },
  // ── Other ──────────────────────────────────────────────────────────────────
  'Other': {
    label: 'Other', group: 'Other',
    keywords: [],
  },
};

// Flat sorted list for dropdowns — grouped by category with optgroup labels.
export const INDUSTRY_GROUPS: Array<{ group: string; options: string[] }> = Object.entries(INDUSTRY_MAP)
  .reduce<Array<{ group: string; options: string[] }>>((acc, [key, def]) => {
    let grp = acc.find((g) => g.group === def.group);
    if (!grp) { grp = { group: def.group, options: [] }; acc.push(grp); }
    grp.options.push(key);
    return acc;
  }, []);

export const INDUSTRY_LIST = Object.keys(INDUSTRY_MAP);

// Resolves keyword templates using the location's city.
function applyCity(template: string, city: string | null | undefined): string {
  if (!city) return template.replace(/ \{city\}/g, '').replace(/\{city\}/g, '');
  return template.replace(/\{city\}/g, city);
}

// Returns seeding keywords for a given industry + city. Falls back to empty array.
export function getIndustryKeywords(industry: string | null | undefined, city?: string | null): string[] {
  if (!industry) return [];
  const def = INDUSTRY_MAP[industry];
  if (!def) return [];
  return def.keywords.map((kw) => applyCity(kw, city));
}

// Returns just the first (primary) keyword — used for audit ranking checks.
export function getPrimaryKeyword(industry: string | null | undefined, city?: string | null): string | null {
  const keywords = getIndustryKeywords(industry, city);
  return keywords[0] ?? null;
}

// Core directories checked for every location
export const CORE_DIRECTORIES = [
  'google', 'bing', 'apple', 'yelp', 'facebook', 'bbb', 'yellowpages',
];

// Additional directories per industry group
const GROUP_DIRECTORIES: Record<string, string[]> = {
  'Home Services': ['angi', 'houzz', 'thumbtack'],
  'Health & Fitness': ['healthgrades', 'zocdoc', 'webmd'],
  'Legal': ['avvo', 'justia', 'findlaw'],
  'Food & Beverage': ['tripadvisor', 'opentable'],
  'Beauty & Personal Care': ['vagaro', 'mindbody'],
  'Automotive': ['repairpal'],
  'Professional Services': ['expertise'],
};

// Returns the curated directory list for a given industry.
export function getDirectoriesForIndustry(industry: string | null | undefined): string[] {
  if (!industry) return CORE_DIRECTORIES;
  const def = INDUSTRY_MAP[industry];
  const extras = def ? (GROUP_DIRECTORIES[def.group] ?? []) : [];
  return [...CORE_DIRECTORIES, ...extras];
}
