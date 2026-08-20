/**
 * Mention detection decides what a paying customer is told about whether AI
 * assistants recommend them. Both failure directions are damaging and neither
 * announces itself:
 *
 *   FALSE POSITIVE — a business called "Tulsa Plumbing" matching the ordinary
 *   phrase "for your Tulsa plumbing needs" reports a recommendation that was
 *   never made. The customer relaxes about a problem they actually have.
 *
 *   FALSE NEGATIVE — "Williams Plumbing" not matching "Williams Plumbing &
 *   Drain Service LLC" reports that ChatGPT ignores them when it does not.
 *
 * The third state exists for exactly the cases where neither answer is
 * supportable, and these tests pin that boundary — that `unverified` is
 * returned, and NOT quietly resolved to `absent`.
 *
 * Fixture text is trimmed from real DataForSEO llm_responses output captured
 * 2026-08-20, so the markdown shapes are the ones the engines actually emit.
 */
import {
  analyzeMention,
  distinctiveTokens,
  extractBusinessNames,
  extractCitations,
  hostnames,
  normalizeForMatch,
} from '../../services/ai_visibility.service';
import { buildPrompt, industryNoun, INDUSTRY_PROMPT_NOUNS, AI_PROMPTS } from '../../config/ai_engines.config';
import { INDUSTRY_MAP } from '../../config/industry.config';

const TULSA = { industry: 'Plumbing', city: 'Tulsa', state: 'OK' };

// Real ChatGPT shape: bulleted, bolded names, markdown citations.
const CHATGPT_ANSWER = `A few Tulsa plumbing companies that appear to be well-regarded are:

- **Acts of Service Plumbing** — shows up highly in local "best plumbers" listings. ([bestprosintown.com](https://www.bestprosintown.com/ok/tulsa/plumbers/?utm_source=openai))
- **Williams Plumbing & Drain Service** — frequently recommended in Tulsa Reddit threads. ([reddit.com](https://www.reddit.com/r/tulsa/comments/1c6fycf/good_plumber_in_tulsa/))
- **Fahnestock Plumbing, HVAC & Electric** — listed by Expertise among Tulsa providers. ([expertise.com](https://www.expertise.com/home-improvement/plumbing/oklahoma/tulsa))

Before hiring, I'd get **2–3 written estimates** and confirm they're licensed.`;

// Real Perplexity shape: prose, bold used for a descriptive phrase as well as names.
const PERPLEXITY_ANSWER = `A few of the **best-known plumbers in Tulsa** from the results are **Half Moon Plumbing & Electric**, and **York Plumbing**.[2][4]`;

describe('normalizeForMatch', () => {
  it('folds ampersands, case and punctuation so name variants converge', () => {
    expect(normalizeForMatch('Williams Plumbing & Drain, LLC.')).toBe('williams plumbing and drain llc');
  });
});

describe('distinctiveTokens', () => {
  it('keeps the parts of a name that actually identify it', () => {
    expect(distinctiveTokens('Williams Plumbing & Drain', TULSA)).toEqual(['williams', 'drain']);
  });

  it('strips the industry noun, the city and the state', () => {
    expect(distinctiveTokens('Tulsa OK Plumbers', TULSA)).toEqual([]);
  });

  it('returns nothing for a name built entirely from generic trade words', () => {
    expect(distinctiveTokens('Tulsa Plumbing Company', TULSA)).toEqual([]);
  });
});

describe('extractBusinessNames', () => {
  it('reads bolded names in the order the answer introduces them', () => {
    expect(extractBusinessNames(CHATGPT_ANSWER, TULSA).map((n) => n.name)).toEqual([
      'Acts of Service Plumbing',
      'Williams Plumbing & Drain Service',
      'Fahnestock Plumbing, HVAC & Electric',
    ]);
  });

  it('rejects bolded prose that is not a business name', () => {
    // Perplexity bolds "best-known plumbers in Tulsa"; treating that as a
    // competitor would corrupt both the rival list and every position number.
    const names = extractBusinessNames(PERPLEXITY_ANSWER, TULSA).map((n) => n.name);
    expect(names).toEqual(['Half Moon Plumbing & Electric', 'York Plumbing']);
  });

  it('rejects bolded labels like "**Overview:**"', () => {
    expect(extractBusinessNames('**Overview:** they do good work', TULSA).map((n) => n.name)).toEqual([]);
  });
});

describe('extractCitations', () => {
  it('returns deduped hostnames in order, without www', () => {
    expect(extractCitations(CHATGPT_ANSWER)).toEqual(['bestprosintown.com', 'reddit.com', 'expertise.com']);
  });
});

describe('analyzeMention', () => {
  it('matches an exact name and reports its rank among the businesses named', () => {
    const r = analyzeMention('Williams Plumbing & Drain Service', CHATGPT_ANSWER, TULSA);
    expect(r.status).toBe('mentioned');
    expect(r.position).toBe(2);
  });

  it('matches when the registered name is longer than the name the model used', () => {
    // Registered as "... Service LLC"; ChatGPT wrote "... Service".
    const r = analyzeMention('Williams Plumbing & Drain Service LLC', CHATGPT_ANSWER, TULSA);
    expect(r.status).toBe('mentioned');
  });

  it('matches when the model uses a longer name than the one registered', () => {
    // Registered as "Williams Plumbing"; the answer says "Williams Plumbing &
    // Drain Service". Distinctive-token fallback carries this.
    const r = analyzeMention('Williams Plumbing', CHATGPT_ANSWER, TULSA);
    expect(r.status).toBe('mentioned');
  });

  it('reports absent when the answer recommends other businesses instead', () => {
    const r = analyzeMention('Broadnax Plumbing', CHATGPT_ANSWER, TULSA);
    expect(r.status).toBe('absent');
    expect(r.position).toBeNull();
    expect(r.businessesNamed).toHaveLength(3);
  });

  it('refuses to call it absent when the answer names nobody', () => {
    // The assistant declined to recommend anyone. That is silence about every
    // business, not a verdict on this one.
    const r = analyzeMention('Broadnax Plumbing', "I can't reliably rank plumbers. Check Google reviews.", TULSA);
    expect(r.status).toBe('unverified');
    expect(r.unverifiedReason).toMatch(/named no businesses/);
  });

  it('refuses to guess when the name is entirely generic trade words', () => {
    // "Tulsa Plumbing" appears verbatim inside ordinary prose here. Answering
    // either way would be a fabrication, so it must be unverified.
    const r = analyzeMention('Tulsa Plumbing', CHATGPT_ANSWER, TULSA);
    expect(r.status).toBe('unverified');
    expect(r.unverifiedReason).toMatch(/generic trade and location words/);
  });

  it('does not match distinctive tokens scattered far apart in the answer', () => {
    // "Acts" and "York" both appear, but belong to two different businesses.
    const r = analyzeMention('Acts York', CHATGPT_ANSWER + '\n\n- **York Plumbing** — also good.', TULSA);
    expect(r.status).toBe('absent');
  });

  it('treats an upstream failure as unverified, never as absent', () => {
    // Guards the empty-answer path: '' must not read as "nobody named you".
    const r = analyzeMention('Williams Plumbing', '', TULSA);
    expect(r.status).toBe('unverified');
  });
});

describe('prompt construction', () => {
  it('gives every industry a natural noun', () => {
    // Adding an industry without a prompt noun would silently fall back to
    // "local businesses" and ask the wrong question for that customer.
    for (const key of Object.keys(INDUSTRY_MAP)) {
      expect(INDUSTRY_PROMPT_NOUNS[key]).toBeDefined();
    }
  });

  it('uses the plural noun a person would say, not the UI label', () => {
    expect(industryNoun('Plumbing')).toBe('plumbers');
    expect(industryNoun('Law Firm')).toBe('law firms');
  });

  it('builds a natural sentence with city and state', () => {
    const p = buildPrompt(AI_PROMPTS[0], { industry: 'Plumbing', city: 'Tulsa', state: 'OK' });
    expect(p).toBe('Who are the best plumbers in Tulsa, OK? List a few companies by name.');
  });

  it('omits the state cleanly rather than leaving a dangling comma', () => {
    const p = buildPrompt(AI_PROMPTS[0], { industry: 'Plumbing', city: 'Tulsa', state: null });
    expect(p).toBe('Who are the best plumbers in Tulsa? List a few companies by name.');
  });

  it('returns null without a city, so the location is skipped not scanned', () => {
    // A place-less prompt returns a national answer; recording "not mentioned"
    // against that would be a fabricated negative.
    expect(buildPrompt(AI_PROMPTS[0], { industry: 'Plumbing', city: null, state: 'OK' })).toBeNull();
  });
});

describe('analyzeMention — generic names marked explicitly', () => {
  it('accepts a generic name when the answer marks it as a business', () => {
    // "Tulsa Plumbing" carries no distinctive tokens, so prose cannot be told
    // from a reference to it — unless the answer itself bolds it as a name.
    // The markup supplies the context the words lack.
    const answer = 'Top options include **Tulsa Plumbing** and **Half Moon Plumbing & Electric**.';
    const r = analyzeMention('Tulsa Plumbing', answer, TULSA);
    expect(r.status).toBe('mentioned');
    expect(r.position).toBe(1);
  });
});

/**
 * Regressions from the first live run against a real business (Aire Serv of
 * South Tulsa, HVAC, Bixby OK) on 2026-08-20. ChatGPT listed it FIRST and we
 * recorded position 2, because two bolded spans that are not businesses were
 * counted ahead of it. Position is the number the customer reads, so an
 * inflated one understates their standing.
 */
describe('extractBusinessNames — live-run regressions', () => {
  const BIXBY = { industry: 'HVAC', city: 'Bixby', state: 'OK' };

  // Trimmed verbatim from the stored response.
  const LIVE = `A few HVAC companies in/near **Bixby, OK** that look worth considering:

1. **Aire Serv of South Tulsa** — Bixby-based; listed by BBB with an **A rating** and serves Bixby.
2. **JayCo HVACR** — Bixby-based; **BBB Accredited** with an **A+ rating**.
3. **Champion Air Services** — Located in Bixby.`;

  it('does not count the location itself as a competitor', () => {
    expect(extractBusinessNames(LIVE, BIXBY).map((n) => n.name)).not.toContain('Bixby, OK');
  });

  it('does not count rating badges as competitors', () => {
    const names = extractBusinessNames(LIVE, BIXBY).map((n) => n.name);
    expect(names).not.toContain('A+ rating');
    expect(names).not.toContain('BBB Accredited');
    expect(names).not.toContain('A rating');
  });

  it('keeps only the three real businesses', () => {
    expect(extractBusinessNames(LIVE, BIXBY).map((n) => n.name)).toEqual([
      'Aire Serv of South Tulsa',
      'JayCo HVACR',
      'Champion Air Services',
    ]);
  });

  it('reports position 1 for the business the answer listed first', () => {
    const r = analyzeMention('Aire Serv of South Tulsa', LIVE, BIXBY);
    expect(r.status).toBe('mentioned');
    expect(r.position).toBe(1);
  });

  it('still counts a business genuinely named after its town', () => {
    // Rejecting the place must be an exact match, or real competitors vanish.
    const text = 'Try **Bixby Heating & Air** or **Champion Air Services**.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toContain('Bixby Heating & Air');
  });
});

describe('hostnames', () => {
  it('strips scheme, path and www, and dedupes in order', () => {
    expect(
      hostnames([
        'https://www.angi.com/companylist/us/ok/bixby/hvac.htm',
        'https://prothermalhvac.com/service-area/bixby-ok/',
        'https://angi.com/other',
      ]),
    ).toEqual(['angi.com', 'prothermalhvac.com']);
  });
});
