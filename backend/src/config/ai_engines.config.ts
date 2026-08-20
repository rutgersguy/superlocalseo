/**
 * The assistants we measure visibility in.
 *
 * WHY DATAFORSEO AND NOT THE PROVIDERS DIRECTLY
 * ---------------------------------------------
 * DataForSEO's ai_optimization/llm_responses API fronts all of these, and we
 * already hold and pay for those credentials. Going direct would mean three new
 * vendor relationships, three new keys in the environment, and three separate
 * billing relationships to deliver the same measurement.
 *
 * WHY THESE MODELS
 * ----------------
 * Fidelity is the entire product. The claim on the marketing site is "this is
 * what your customers are told", so the model has to be the one a consumer
 * actually reaches. Cheaper non-reasoning models are available (gpt-4o-mini and
 * friends) at roughly a third of the cost, and measuring them would be measuring
 * an assistant nobody uses.
 *
 * `webSearch` is non-negotiable on every engine. A model without web search
 * cannot know that a plumber in Tulsa exists, so it either invents one or
 * declines — both of which are measurement noise rather than a signal about the
 * customer.
 *
 * COST, measured 2026-08-20 against a live "best plumbers in Tulsa" prompt:
 *
 *   chat_gpt   gpt-5.5             $0.0777   (10,730 input tokens — search results dominate)
 *   gemini     gemini-3.5-flash    $0.0345
 *   perplexity sonar               $0.0058
 *
 * At four prompts per location that is ~$0.47 a scan, ~$2/location/month on the
 * weekly cadence. Existing data cost is ~$1.82/location/month, so this roughly
 * doubles it and remains under 1% of a Pro subscription.
 *
 * Claude is supported by the upstream API and deliberately not enabled: the
 * marketing claim names ChatGPT, Gemini and Perplexity, and we do not scan — or
 * bill for — engines we do not report on. Flip `enabled` if that claim changes.
 */
export interface AiEngineDef {
  /** Stored in ai_visibility_snapshots.engine — also the DataForSEO path segment. */
  key: string;
  label: string;
  modelName: string;
  enabled: boolean;
}

export const AI_ENGINES: AiEngineDef[] = [
  { key: 'chat_gpt',   label: 'ChatGPT',    modelName: 'gpt-5.5',          enabled: true  },
  { key: 'gemini',     label: 'Gemini',     modelName: 'gemini-3.5-flash', enabled: true  },
  { key: 'perplexity', label: 'Perplexity', modelName: 'sonar',            enabled: true  },
  { key: 'claude',     label: 'Claude',     modelName: 'claude-sonnet-5',  enabled: false },
];

export const ENABLED_AI_ENGINES = AI_ENGINES.filter((e) => e.enabled);

export function aiEngineLabel(key: string): string {
  return AI_ENGINES.find((e) => e.key === key)?.label ?? key;
}

/**
 * The prompts, phrased the way a person actually asks — not as keywords.
 *
 * `key` is stable and stored, so a prompt's wording can be improved without
 * orphaning its history. Changing a key starts a new series; changing the text
 * under an existing key does not, which is the behaviour we want for small
 * rewordings and NOT for a change of intent.
 *
 * Four prompts covers the distinct intents that matter (open recommendation,
 * urgency, trust, price) without multiplying spend. `{industry}` resolves to the
 * industry's natural noun and `{place}` to "City, ST" — or bare "City" when the
 * state is unknown, which is why it is one token and not two. Interpolating
 * `{city}, {state}` separately leaves a dangling comma on state-less locations
 * ("in Tulsa, ?"), and patching that up afterwards couples the builder to the
 * exact wording of every template.
 */
export interface AiPromptDef {
  key: string;
  intent: string;
  template: string;
}

export const AI_PROMPTS: AiPromptDef[] = [
  {
    key: 'best_open',
    intent: 'Open recommendation — the broadest and most common phrasing',
    template: 'Who are the best {industry} in {place}? List a few companies by name.',
  },
  {
    key: 'emergency',
    intent: 'Urgency — the highest-intent moment, when the customer will call the first name given',
    template: 'I need an emergency {industry} in {place} right now. Which company should I call?',
  },
  {
    key: 'most_trusted',
    intent: 'Trust — surfaces whoever owns the reputation signals',
    template: 'Which {industry} company in {place} is the most trusted and highly rated?',
  },
  {
    key: 'affordable',
    intent: 'Price — a different set of businesses usually surfaces here',
    template: 'Who is a reliable, affordable {industry} in {place}?',
  },
];

/**
 * How each industry is named inside a prompt.
 *
 * `INDUSTRY_MAP` keys are UI labels ("Plumbing", "Law Firm"), and dropping those
 * into a sentence produces "the best Plumbing in Tulsa" — which is not how
 * anyone asks, and which measurably changes what the model returns. This maps
 * each to the plural noun a person would actually say.
 *
 * Keys here must stay in step with `INDUSTRY_MAP` in industry.config.ts;
 * `industry-prompts.test.ts` fails if an industry is added there without a noun
 * here, so this cannot silently drift.
 */
export const INDUSTRY_PROMPT_NOUNS: Record<string, string> = {
  'Plumbing': 'plumbers',
  'HVAC': 'HVAC companies',
  'Electrical': 'electricians',
  'Roofing': 'roofers',
  'Landscaping': 'landscapers',
  'Cleaning': 'house cleaning services',
  'Pest Control': 'pest control companies',
  'Painting': 'house painters',
  'Flooring': 'flooring companies',
  'Moving': 'moving companies',
  'General Contractor': 'general contractors',
  'Personal Training': 'personal trainers',
  'Gym / Fitness Studio': 'gyms',
  'Physical Therapy': 'physical therapists',
  'Chiropractic': 'chiropractors',
  'Massage Therapy': 'massage therapists',
  'Dental': 'dentists',
  'Law Firm': 'law firms',
  'Family Law': 'family law attorneys',
  'Personal Injury': 'personal injury lawyers',
  'Restaurant': 'restaurants',
  'Coffee Shop': 'coffee shops',
  'Food Truck': 'food trucks',
  'Bakery': 'bakeries',
  'Hair Salon': 'hair salons',
  'Barbershop': 'barbershops',
  'Nail Salon': 'nail salons',
  'Med Spa': 'med spas',
  'Auto Repair': 'auto repair shops',
  'Auto Detailing': 'auto detailing services',
  'Accounting / CPA': 'accountants',
  'Real Estate': 'real estate agents',
  'Property Management': 'property management companies',
  'Insurance': 'insurance agents',
  'Veterinary': 'veterinarians',
  'Photography': 'photographers',
  'Tutoring': 'tutors',
  'Other': 'local businesses',
};

export function industryNoun(industry: string | null | undefined): string {
  if (!industry) return INDUSTRY_PROMPT_NOUNS['Other'];
  return INDUSTRY_PROMPT_NOUNS[industry] ?? INDUSTRY_PROMPT_NOUNS['Other'];
}

/**
 * Fills a prompt template.
 *
 * Returns null when the location has no city. A prompt without a place produces
 * a national answer, which is not the question this feature asks — and recording
 * that answer as "you were not mentioned" would be a fabricated negative.
 * Callers skip, rather than scan, a location that returns null.
 */
export function buildPrompt(
  tpl: AiPromptDef,
  opts: { industry: string | null; city: string | null; state: string | null },
): string | null {
  const city = opts.city?.trim();
  if (!city) return null;
  const state = opts.state?.trim();
  const place = state ? `${city}, ${state}` : city;

  return tpl.template
    .replace('{industry}', industryNoun(opts.industry))
    .replace('{place}', place);
}
