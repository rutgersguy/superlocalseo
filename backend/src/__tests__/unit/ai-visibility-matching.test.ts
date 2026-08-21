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
  mergeBusinessCounts,
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

/**
 * Regressions from the first FOUR-engine run (Claude enabled), 2026-08-20.
 *
 * Claude formats far more variably than the other three and surfaced a second
 * crop of bolded non-names that the earlier filter let through: section
 * headings, rating claims, a street address, and — worst — the same business
 * twice, once bare and once with its phone number appended, which counts as two
 * competitors and pushes the customer's position down by one.
 *
 * Every string below was taken verbatim from stored `businesses_named` rows.
 */
describe('extractBusinessNames — four-engine regressions', () => {
  const BIXBY = { industry: 'HVAC', city: 'Bixby', state: 'OK' };

  const junk = [
    'My recommendation',
    '4.9 stars with 1,880+ Google reviews',
    'BBB Accredited with an A+ rating',
    'A+ rating with the Better Business Bureau (BBB)',
    'A rating with the BBB',
    '100% Recommended',
    '505 N Armstrong St STE AB',
  ];

  for (const j of junk) {
    it(`rejects "${j}"`, () => {
      const text = `Some options: **${j}** and **Torch Plumbing**.`;
      expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).not.toContain(j);
    });
  }

  it('collapses a business repeated with its phone number appended', () => {
    // Claude writes both forms in one answer. Two entries for one company
    // inflates the rival count and every position below it.
    const text = 'Call **Service Wizards** today. Best: **Service Wizards (918-400-4444)** and **LEE Heat & Air (918-300-0404)**.';
    const names = extractBusinessNames(text, BIXBY).map((n) => n.name);
    expect(names).toEqual(['Service Wizards', 'LEE Heat & Air']);
  });

  it('still keeps the real businesses from the same answer', () => {
    const text = '**My recommendation:** go with **Torch Plumbing, Heating, & Cooling** or **Air Comfort Solutions**.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual([
      'Torch Plumbing, Heating, & Cooling',
      'Air Comfort Solutions',
    ]);
  });

  it('does not count junk toward the customer position', () => {
    const text = '**4.9 stars with 1,880+ Google reviews** — **Aire Serv of South Tulsa** leads locally.';
    const r = analyzeMention('Aire Serv of South Tulsa', text, BIXBY);
    expect(r.status).toBe('mentioned');
    expect(r.position).toBe(1);
  });
});

/**
 * The blocklist-of-words approach could not keep up with a non-deterministic
 * model: each run produced phrasings it had never seen. These came from the
 * SECOND four-engine run, after the first round of word-list fixes, and drove
 * the switch to a structural title-case rule.
 */
describe('extractBusinessNames — proper-noun rule', () => {
  const BIXBY = { industry: 'HVAC', city: 'Bixby', state: 'OK' };

  const sentenceCase = [
    'BBB-accredited / formal reputation',
    'My practical recommendation',
    'Searching for recommendations',
    'What to ask before you book',
    'Best value for most homeowners',
  ];

  for (const j of sentenceCase) {
    it(`rejects sentence-case phrase "${j}"`, () => {
      const text = `**${j}**: try **Air Comfort Solutions**.`;
      expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).not.toContain(j);
    });
  }

  const realNames = [
    'Air Comfort Solutions',
    'LEE Heat & Air',
    'Torch Plumbing, Heating, & Cooling',
    'Aire Serv of South Tulsa',
    "Dale & Lee's",
    'JayCo HVACR LLC',
    'TemperaturePro Tulsa',
  ];

  for (const n of realNames) {
    it(`keeps real business name "${n}"`, () => {
      const text = `Options include **${n}** locally.`;
      expect(extractBusinessNames(text, BIXBY).map((x) => x.name)).toContain(n);
    });
  }
});

/**
 * From the third four-engine run. Two problems the earlier filters left behind,
 * both of which corrupt the competitor list a Pro customer reads:
 *
 *   Title Case advice headings — "Get Multiple Estimates", "Verify Licensing" —
 *   pass the proper-noun rule because they genuinely are title case.
 *
 *   One company named at several lengths in one answer. "Aire Serv" appeared
 *   SIX ways in a single response and counted as six competitors.
 */
describe('extractBusinessNames — headings and variants', () => {
  const BIXBY = { industry: 'HVAC', city: 'Bixby', state: 'OK' };

  const headings = [
    'Get Multiple Estimates',
    'Get Multiple Quotes on Replacements',
    'Ask About Warranties',
    'Verify Licensing',
    'Verifying HVAC Licenses',
    'Tips for Finding the Best Deal',
    'Immediate Action Tips While You Wait',
    'Affordability',
    'Reputation',
    'Contact',
  ];

  for (const h of headings) {
    it(`rejects advice heading "${h}"`, () => {
      const text = `**${h}** — also consider **Air Comfort Solutions**.`;
      expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).not.toContain(h);
    });
  }

  it('collapses the six ways one answer named a single company', () => {
    const text = [
      'Try **Aire Serv**.',
      'Specifically **Aire Serv (South Tulsa/Bixby)**.',
      'Full name: **Aire Serv of South Tulsa**.',
      'Also **Aire Serv of South Tulsa (Bixby Location)**.',
      'Or **Aire Serv of South Tulsa (Located in Bixby)**.',
      'Listed as **Aire Serv of South Tulsa — Bixby**.',
    ].join('\n');

    const names = extractBusinessNames(text, BIXBY).map((n) => n.name);
    expect(names).toEqual(['Aire Serv of South Tulsa']);
  });

  it("folds Campbell's and Campbells together", () => {
    const text = "**Campbell’s Heating & Air Conditioning**, also written **Campbells Heating & Air Conditioning**.";
    expect(extractBusinessNames(text, BIXBY)).toHaveLength(1);
  });

  it('keeps two genuinely different franchise locations apart', () => {
    // Prefix, not containment — these are plausibly separate businesses.
    const text = '**TemperaturePro Bixby** and **TemperaturePro Tulsa** both serve the area.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual([
      'TemperaturePro Bixby',
      'TemperaturePro Tulsa',
    ]);
  });

  it('does not let duplicate variants inflate the customer position', () => {
    // Ours is named second; the rival's three forms must count once.
    const text = '**Torch** is popular. **Torch Plumbing, Heating & Cooling** is the full name. Then **Aire Serv of South Tulsa**.';
    const r = analyzeMention('Aire Serv of South Tulsa', text, BIXBY);
    expect(r.status).toBe('mentioned');
    expect(r.position).toBe(2);
  });
});

/**
 * Fourth run. Every string here was captured from live output; each is a
 * different markdown shape the previous passes had not seen. Recorded as tests
 * because the extractor is chasing a non-deterministic writer, and a fix that
 * is not pinned gets undone by the next tuning pass.
 */
describe('extractBusinessNames — markdown shapes from live runs', () => {
  const BIXBY = { industry: 'HVAC', city: 'Bixby', state: 'OK' };

  it('strips a list number written inside the bold', () => {
    // "**1. Aire Serv of South Tulsa**". Left in, the prefix defeats variant
    // collapsing — "1. Aire Serv" is not a prefix of "Aire Serv of South Tulsa"
    // — so one company was still counted twice.
    const text = '**1. Aire Serv of South Tulsa** is local. Later: **7. Aire Serv** again.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual(['Aire Serv of South Tulsa']);
  });

  it('keeps a hyphenated name intact', () => {
    // The trailing-qualifier rule treated a plain hyphen as a separator and
    // turned "Okla-Home Heating & Cooling" into "Okla".
    const text = 'Try **Okla-Home Heating & Cooling**.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual(['Okla-Home Heating & Cooling']);
  });

  it('rejects a contact fragment', () => {
    const text = '**Call/Text: (918) 479-0000** or **Air Assurance**.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual(['Air Assurance']);
  });

  it('recognises the place when the state is spelled out', () => {
    // "Bixby, OK" was caught; "Bixby, Oklahoma" was not, and became a competitor.
    const text = 'Companies in **Bixby, Oklahoma** include **Evans Mechanical**.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual(['Evans Mechanical']);
  });

  it('takes the first form when one company is written two ways with a slash', () => {
    const text = '**JayCo HVACR LLC / Jayco Heat & Air** serves Bixby.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual(['JayCo HVACR LLC']);
  });
});

describe('extractBusinessNames — heading markdown leakage', () => {
  const BIXBY = { industry: 'HVAC', city: 'Bixby', state: 'OK' };

  it('does not leave markdown asterisks in the displayed name', () => {
    // "### 1. **Air Dynamics of Tulsa** (Highly Rated for Transparency)".
    // The heading pattern captures the closing asterisks and the parenthetical
    // strip runs after them, so "Air Dynamics of Tulsa**" reached the customer.
    const text = '### 1. **Air Dynamics of Tulsa** (Highly Rated for Transparency)\nGood company.';
    expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).toEqual(['Air Dynamics of Tulsa']);
  });

  for (const h of ['Good for', 'Important', 'Location', 'Contact Details']) {
    it(`rejects the section label "${h}"`, () => {
      const text = `**${h}** — see **Patton Air**.`;
      expect(extractBusinessNames(text, BIXBY).map((n) => n.name)).not.toContain(h);
    });
  }
});

describe('mergeBusinessCounts', () => {
  it('folds variants of one company across answers into a single total', () => {
    // Observed live: four answers named the same company three ways. The Pro
    // "who the assistants name" list showed them as three competitors.
    const counts = mergeBusinessCounts([
      'Aire Serv',
      'Aire Serv of South Tulsa',
      'Aire Serv of South Tulsa',
      'Patton Air',
    ]);

    expect(counts).toEqual([
      { name: 'Aire Serv of South Tulsa', timesNamed: 3, isYou: false },
      { name: 'Patton Air', timesNamed: 1, isYou: false },
    ]);
  });

  it('folds punctuation and ampersand spellings together', () => {
    const counts = mergeBusinessCounts([
      'ProThermal Heating & Cooling',
      'ProThermal Heating and Cooling',
      'Miller Heat and Air LLC',
      'Miller Heat and Air, LLC',
    ]);
    expect(counts).toHaveLength(2);
    expect(counts.every((c) => c.timesNamed === 2)).toBe(true);
  });

  it('keeps genuinely different companies apart', () => {
    const counts = mergeBusinessCounts(['TemperaturePro Bixby', 'TemperaturePro Tulsa']);
    expect(counts).toHaveLength(2);
  });
});

describe('mergeBusinessCounts — marking the customer', () => {
  it("marks the customer's own business, however it was written", () => {
    // It is named more often than anyone else — it is the business we asked
    // about — so unmarked it tops a list headed "who the assistants named" and
    // reads as though they compete with themselves. Caught in the August PDF.
    const counts = mergeBusinessCounts(
      ['Aire Serv of South Tulsa', 'Aire Serv', 'Wagnon Heating & Air', 'Patton Air'],
      ['Aire Serv of South Tulsa'],
    );

    const you = counts.find((c) => c.isYou);
    expect(you).toEqual({ name: 'Aire Serv of South Tulsa', timesNamed: 2, isYou: true });
    expect(counts.filter((c) => c.isYou)).toHaveLength(1);
  });

  it('marks nobody when no self name is supplied', () => {
    const counts = mergeBusinessCounts(['Patton Air', 'Aire Serv']);
    expect(counts.every((c) => !c.isYou)).toBe(true);
  });

  it('does not mark a different business with a similar start', () => {
    const counts = mergeBusinessCounts(['Air Comfort Solutions'], ['Air Assurance Company']);
    expect(counts[0].isYou).toBe(false);
  });
});

describe('mergeBusinessCounts — account name vs location name', () => {
  it('matches on the LOCATION name when the account name differs', () => {
    // Real case from the first August report: the account is registered as
    // "AirServe of Tulsa" while the location — the name the AI scan actually
    // asks about, and the one that comes back in the answers — is "Aire Serv of
    // South Tulsa". Neither is a prefix of the other, so matching on the
    // account name alone marked nothing and the customer topped their own
    // competitor list.
    const counts = mergeBusinessCounts(
      ['Aire Serv of South Tulsa', 'Wagnon Heating & Air'],
      ['AirServe of Tulsa', 'Aire Serv of South Tulsa'],
    );

    expect(counts.find((c) => c.name === 'Aire Serv of South Tulsa')?.isYou).toBe(true);
    expect(counts.find((c) => c.name === 'Wagnon Heating & Air')?.isYou).toBe(false);
  });

  it('ignores empty and null names in the self list', () => {
    const counts = mergeBusinessCounts(['Patton Air'], [null, '', undefined]);
    expect(counts[0].isYou).toBe(false);
  });
});
