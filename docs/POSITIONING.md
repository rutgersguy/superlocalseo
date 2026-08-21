# SuperLocalSEO — Positioning Brief

**Audience:** Anyone writing customer-facing words or designing customer-facing surfaces —
marketing pages, ads, emails, onboarding copy, sales conversations, AI copy tools.

**Status:** Source of truth for *who we sell to and how we talk about it*, decided 2026-08-20.
[PRODUCT.md](PRODUCT.md) remains the source of truth for *what the product does*;
[PRICING.md](PRICING.md) for *what it costs*. Where PRODUCT.md's older agency framing
conflicts with this file, **this file wins** — that framing predates the Lite/Pro split and
is retired.

---

## The decision

Four forks were settled on 2026-08-20:

| Fork | Decision |
|---|---|
| Audience | **Direct to business owners.** Not agencies, not white-label. |
| Vertical | **Home services beachhead** — plumbing, HVAC, electrical, roofing. |
| Lead claim | **AI visibility** — do AI assistants recommend this business? |
| Visual identity | **Keep** the existing wordmark and brand palette. Reposition via structure and copy. |

Everything below follows from those four.

---

## Who we sell to

The owner or office manager of a home-services business with one to a few locations. They
already pay for field-service software (Jobber, Housecall Pro, ServiceTitan) and probably for
leads (Angi, Nextdoor). They are not marketers. They have never read an SEO blog and never
will.

**We do not sell to agencies.** The product is self-serve, priced per business, and billed
through Stripe checkout at signup. There is no white-label tier, no reseller pricing, and no
sub-account model for resellers. Copy that implies otherwise creates support load and refund
requests.

Other industries — dental, legal, beauty, real estate — are supported in the product and are
welcome to sign up. We simply stop *leading* with them. The citation engine is already
industry-segmented (see [`directories.config.ts`](../backend/src/config/directories.config.ts)),
so "every industry" was never true of the product anyway, and specificity is what sells when
we have no testimonials.

---

## Who we actually compete with

The instinct is to benchmark against local-SEO tools. That instinct is the single most
expensive mistake available to us, because of where our price sits:

| Bucket | Price | Examples |
|---|---|---|
| Tools | ~$30–80/mo | BrightLocal, Whitespark, Moz Local, Local Falcon |
| **SuperLocalSEO** | **$149–349/mo** | — |
| Outcome platforms | ~$250–600/mo | Podium, Birdeye |
| Done-for-you agencies | $1,500–5,000/mo | Scorpion, Blue Corona, regional shops |

*(Competitor prices are approximate and drift; re-check before quoting any of them publicly.)*

A prospect who reads us as a **tool** anchors on BrightLocal's ~$39 and concludes we are nine
times overpriced. A prospect who reads us as an **alternative to their agency** anchors on
$2,500/mo and concludes we are a bargain. Same product, same price — the page decides which
happens.

**So: we are not competing with BrightLocal. We are competing with the local agency retainer,
and winning on price.** Every structural choice should push the reader toward that comparison
and away from the tool shelf. This is why the feature grid was cut (see below) — a wall of
icon cards is the strongest available signal that we are a utility.

Two other reference sets worth studying, for opposite reasons:

- **Podium and Birdeye** — our closest true analogues in price *and* buyer. Sold on outcomes,
  proof-heavy, almost no feature grid above the fold. Study what they do.
- **Jobber and Housecall Pro** — not competitors, but they already own our buyer's idea of
  what "software for my trade" sounds like: warm, plainspoken, respectful of the tradesperson
  without condescending. Borrow the voice. Avoid the Silicon Valley developer-tool aesthetic;
  it reads as foreign to this buyer.

---

## The lead claim

> **Do AI assistants recommend your business?**

This is the wedge, and it goes in the hero.

Why this one:

- It is a question the owner **cannot answer** and has recently started worrying about.
- It requires **no jargon** to understand. A plumber gets it in one sentence.
- The AI-visibility category (Profound, Peec, Otterly, Scrunch, Brandlight, AthenaHQ) is real
  and growing, and **every incumbent points at enterprise brands.** Nobody is serving the local
  service business. The lane is open.
- It is the one part of our stack that is **not a vendor passthrough.** Rankings, citations and
  reviews are BrightLocal / DataForSEO / EMR data that a competitor can buy tomorrow. This
  can't be bought off a shelf, which is exactly the moat a premium price needs.

Rankings, reviews and citations become *how* we deliver visibility — not the headline.

### The obligation this creates

**We must actually track AI visibility in the paid product before the page promises it.**

As of 2026-08-20, ChatGPT / Gemini / Perplexity appeared in exactly one file in this repo —
`frontend/src/pages/Landing.tsx` — as a claim about the free report. There was no job, no
table, and no dashboard surface. Leading with a claim the $349/mo product does not deliver is
the one mistake this positioning cannot survive, precisely because we have no social proof to
absorb the damage.

**Rule: the hero claim and the dashboard must match. If tracking regresses or is removed, the
hero changes the same day.**

Status:

| Piece | State |
|---|---|
| Weekly measurement across ChatGPT, Claude, Gemini and Perplexity | **Shipped** — `ai_visibility.job.ts`, Mondays 08:00 UTC |
| Storage with history | **Shipped** — `ai_visibility_snapshots` |
| API endpoint | **Shipped** — `GET /api/ai-visibility`, plan-aware payload |
| Dashboard surface | **Shipped** — hero panel on `/dashboard` + full page at `/dashboard/ai-visibility` |
| Monthly PDF section | **Shipped** — under the executive summary, with month-over-month movement |

**The rule is satisfied for the web product.** A customer logging in now sees the answer to the
same question the site asks, above the ranking metrics. The landing page rebuild is unblocked.

The plan split, decided 2026-08-20: **Lite gets the verdict** — which assistants name them and
where they rank — because that is what the hero converts on and paywalling it would sell Lite a
promise it cannot open. **Pro gets the depth**: competitors named, sources cited, week-over-week
history, and the stored answer behind each verdict. The Pro fields are omitted from the payload
server-side rather than hidden by the UI (#157).

---

## How we earn trust without social proof

We have no named customers, no case studies, and no logos. We therefore **cannot borrow
trust — we have to demonstrate it.** Published method is the testimonial substitute:

> For a plumbing company we check 14 directories — the 10 that matter for every local business,
> plus Angi, Houzz, Thumbtack and HomeAdvisor. We picked them by measurement, not opinion: we
> tested them against real businesses and dropped anything we found less than 25% of the time.
> We re-check every Monday, and we keep every snapshot we've ever taken.

Every clause there is verifiable in this repo. This paragraph does more work than a testimonial
would, and competitors will not copy it, because publishing your hit rates only works if they
are good.

### Two disciplines that make it true

**Quote the customer's number, never the system's.** The registry holds 33 auditable
directories, but no business is ever scanned against 33 — each gets the 10 core directories
plus its own vertical's. A home-services business gets **14**. Quoting 33 would be true of the
system and misleading about the customer's report, so we quote the number that customer
actually receives. (`Landing.tsx` has carried this rule as a code comment since the citation
rebuild; its own figures — "24 audited, 8 core" — are stale, but the principle stands.)

**Do not claim competitors lack history.** Our permanent-snapshot advantage is real relative to
the pay-per-request Data API we consume, but BrightLocal sells rank tracking with history on
its subscription plans. Stating "BrightLocal doesn't keep history" as a public claim is a
falsifiable attack on a named competitor and it is not worth the risk. Make the positive claim
— we keep every snapshot forever — and let the reader draw the comparison.

The three trust assets we do have, in order of strength:

1. **Method transparency** — measured directory selection, weekly cadence, permanent history.
2. **Real product surfaces** — the geo-grid heatmap is the signature visual. Nobody at our
   price point shows one, and it reads as evidence at a glance.
3. **The free report itself** — a live demonstration beats a claim about a demonstration.

Verified counts as of 2026-08-20 (`backend/src/config/directories.config.ts`): 53 registry
entries, 18 dropped on measurement with their rates recorded, 2 unauditable by any search-based
method (Apple Maps, Bing Places — surfaced as "claim this yourself", never scored), leaving
**33 auditable**: 10 core + 23 across eight verticals. Re-verify before publishing any figure;
the registry changes when matching changes.

**Do not ship placeholder social proof.** The retired line *"Trusted by local businesses across
every industry"* — no logos, no names, no numbers — reads as "we have no customers" and did
active damage at a $349 price point.

---

## Voice

Plainspoken like Jobber. Evidenced like a lab report.

**Banned above the fold** — jargon our buyer does not use: *citations, NAP consistency, local
pack, SERP, GEO, schema, backlinks, domain authority*. These are fine deeper in the page and in
the app, where the reader has already opted in.

**Preferred:** concrete nouns and real numbers over adjectives. "We re-check every Monday"
beats "always up to date." "33 directories" beats "comprehensive coverage."

**Never:** "revolutionary," "cutting-edge," "unlock the power of," "in today's digital
landscape."

---

## Landing page structure

1. **Hero** — the AI question, and a mocked assistant answer in which the business is *not*
   named. **The inline business-name input was specified and could not be built.** The free
   report lives on `app.superlocalseo.com/intel-request`, which is the white-labeled
   EmbedMyReviews app, not ours: the form is Laravel Livewire (stateful, checksummed) so it
   cannot be posted to cross-origin, and it ignores query parameters, so forwarding what the
   visitor typed would make them type it again. A button that does not double-type beats an
   input that does. Revisit if that page ever comes under our control.
2. **What the free report tells you** — real rendered output.
3. **The full picture** — geo-grid heatmap as the signature visual.
4. **How we know** — published method. This replaces the testimonial section.
5. **Pricing** — Lite / Pro, no setup fee. Derived from `productLine`, never hardcoded.
6. **FAQ.**

### Cut, and why

| Removed | Reason |
|---|---|
| The eight-card icon feature grid | Strongest available signal that we are a $39 tool |
| "Trusted by local businesses across every industry" | Reads as "we have no customers"; also contradicts our industry-segmented citation engine |
| "Local SEO that actually shows up on the map" | It is what BrightLocal says at a fifth of the price |

---

## Where positioning is expressed in code

Positioning drifts the same way pricing drifts — it lives in more places than anyone remembers.
Keep these in sync:

| Surface | File | Notes |
|---|---|---|
| Landing copy + FAQ | `frontend/src/pages/Landing.tsx` | Primary surface |
| SEO title / meta / JSON-LD | `frontend/index.html` | **Not React — easy to miss.** Retired pricing shipped to Google for months this way (#153) |
| Registration copy | `frontend/src/pages/Register.tsx` | |
| Trial upsell | `frontend/src/pages/Dashboard.tsx` | |
| Transactional email copy | `backend/src/services/email.service.ts` | |
| Product reference | `docs/PRODUCT.md` | Elevator pitch + target customer must match this file |

**Deploy note:** the web service is a production build and is **not** bind-mounted. Landing
changes need `docker compose build web && docker compose up -d web` — a plain `restart` will
silently re-serve the old bundle.
