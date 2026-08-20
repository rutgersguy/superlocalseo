import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Sparkles, Check, X, MapPin, Star, FileText } from 'lucide-react';

/**
 * Landing page, rebuilt 2026-08-20 to the brief in docs/POSITIONING.md.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The old page sold a dashboard: an eight-card icon grid under "Everything you
 * need to rank locally". That is tool positioning at platform pricing — a
 * visitor who reads us as a tool anchors on BrightLocal's ~$39 and concludes we
 * are nine times overpriced. We are not competing with rank trackers; we are
 * competing with the $1,500–5,000/mo local agency and winning on price.
 *
 * So the page now leads on AI visibility, which is the one claim no competitor
 * at this price is making and which the product actually delivers as of #191.
 * Rankings, reviews and listings appear as HOW we do it, not as a feature wall.
 *
 * NO SOCIAL PROOF EXISTS. There are no customers we can name, so the page
 * cannot borrow trust and has to demonstrate it instead — hence "How we know",
 * which publishes the method and the real numbers. The retired line "Trusted by
 * local businesses across every industry" carried no logo, name or number and
 * read as "we have no customers".
 *
 * VOICE: plainspoken. No SEO jargon above the fold — no "citations", "NAP
 * consistency", "local pack", "SERP", "schema" or "domain authority". Our buyer
 * is a plumber, not a marketer.
 */

const INTEL_URL = 'https://app.superlocalseo.com/intel-request';

/**
 * Prices live here once.
 *
 * PRICING.md is the source of truth and lists every surface that displays a
 * price; hardcoded pricing has shipped wrong to production twice (#113, #125).
 * This page is public and cannot read `productLine` from an authenticated
 * client, so it cannot derive them — the least-bad alternative is a single
 * constant rather than the numbers scattered through the markup, which is how
 * the retired $499 setup fee survived in three places after it was waived.
 */
const PRICING = {
  lite: 149,
  pro: 349,
  extraLocation: 125,
  setupFeeAnchor: 499, // struck through — waived, never charged (STRIPE_SETUP_FEE_ENABLED)
} as const;

/**
 * The assistant answer shown in the hero.
 *
 * Businesses are INVENTED. Showing a real local company as the one that beat
 * you would be using a named third party as a negative example in our own
 * advertising, which is not a thing we are going to do. Generic names carry the
 * point — that the reader is not on the list — without that problem.
 */
const MOCK_ANSWER = [
  { name: 'Cardinal Plumbing & Drain', note: 'Highly rated locally, 240+ reviews' },
  { name: 'Riverside Home Services', note: 'Listed across the major directories' },
  { name: 'Homestead Plumbing Co.', note: 'Frequently recommended in local forums' },
];

const faqs = [
  {
    q: 'What does "AI visibility" actually mean?',
    a: 'When someone asks ChatGPT, Claude, Gemini or Perplexity for a plumber or an HVAC company in your town, those tools answer with a short list of businesses by name. If you are not on that list, you never get the call — and unlike Google, there is no results page to scroll. Every Monday we ask all four the questions your customers ask, and show you whether you were named and where you came in the order.',
  },
  {
    q: 'How is that different from Google rankings?',
    a: 'They are two different front doors and you need both. We track your Google rankings every day and keep the full history, so you can see where you stand and how it is moving. AI assistants are the newer door, and they draw on different sources — review sites, directories, local forums — so it is common to rank well on Google and still be invisible to ChatGPT. We show you both in one place.',
  },
  {
    q: 'What is the free visibility report?',
    a: 'A no-strings snapshot of your business: your review standing, how you compare to nearby competitors, what customers say in your reviews, and whether AI tools recommend you. Enter your business name and city and we email the full report in about two minutes. No account, no credit card.',
  },
  {
    q: 'What do I need to get started?',
    a: 'Your business name, your address and the services you want to be found for. Rank tracking starts automatically — there is nothing to install and nothing to configure. Connecting your Google Business Profile during setup also pulls your reviews in so you can reply to them from one place.',
  },
  {
    q: 'How does the free trial work?',
    a: `Seven days free, no credit card to start. The trial runs with full Pro access so you can see everything. At checkout you pick the plan that fits — Lite at $${PRICING.lite}/mo or Pro at $${PRICING.pro}/mo — and that is when billing begins. There is no setup fee on either plan.`,
  },
  {
    q: "What's the difference between Lite and Pro?",
    a: `Lite ($${PRICING.lite}/mo) covers one location: daily rank tracking, review monitoring with AI-drafted replies, review request campaigns, your monthly report, and the AI visibility verdict — which assistants recommend you and where you place. Pro ($${PRICING.pro}/mo) adds the depth behind that verdict (who the assistants name instead, which sources they trust, how it moves week to week), plus weekly directory checks, visibility heatmaps, competitor intelligence, full audits, revenue attribution, team members and exports. Pro also lets you add locations at $${PRICING.extraLocation}/mo each. Start on Lite and upgrade whenever.`,
  },
  {
    q: 'What if my business name is very generic?',
    a: 'It is a real limitation and we would rather say so. If your business is called something like "Tulsa Plumbing", we cannot reliably tell a mention of you apart from ordinary text in an answer, so we mark that check "couldn\'t verify" instead of guessing. It is never counted against you, and we can set up a custom match — just ask.',
  },
  {
    q: 'Is my data secure?',
    a: 'Traffic is served over TLS, passwords are hashed with bcrypt, and any third-party keys are encrypted with AES-256-GCM. We never store credentials in plain text.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        className="w-full flex items-center justify-between py-5 text-left text-slate-900 font-medium text-sm hover:text-brand-500 transition-colors gap-4"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {q}
        <ChevronDown
          size={18}
          className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <p className="pb-5 text-sm text-slate-600 leading-relaxed">{a}</p>}
    </div>
  );
}

// ─── Hero visual: an assistant answer you are not in ─────────────────────────

function AssistantAnswerMock() {
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden text-left max-w-lg mx-auto">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/70">
        <Sparkles size={14} className="text-brand-500" />
        <span className="text-xs font-medium text-slate-500">Example answer from an AI assistant</span>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">"Who's the best plumber in my area?"</span>
        </p>

        <ol className="space-y-2.5">
          {MOCK_ANSWER.map((b, i) => (
            <li key={b.name} className="flex gap-2.5">
              <span className="text-sm font-semibold text-slate-400 shrink-0">{i + 1}.</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{b.name}</p>
                <p className="text-xs text-slate-500">{b.note}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-xl border-2 border-dashed border-red-200 bg-red-50/50 px-4 py-3 flex items-center gap-2.5">
          <X size={15} className="text-red-500 shrink-0" strokeWidth={3} />
          <p className="text-sm font-semibold text-red-700">Your business isn't on the list.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Geo-grid heatmap ────────────────────────────────────────────────────────

/**
 * A representation of the geo-grid report, drawn rather than screenshotted so
 * it stays sharp on every display and needs no asset pipeline. The pattern is
 * the real shape of the thing: strong at the shop, fading with distance.
 */
function GeoGridVisual() {
  const grid = [
    [8, 7, 6, 6, 7, 9, 12],
    [7, 5, 4, 3, 4, 6, 9],
    [6, 4, 2, 2, 2, 4, 7],
    [5, 3, 1, 1, 1, 3, 6],
    [6, 4, 2, 2, 3, 5, 8],
    [8, 6, 5, 4, 5, 7, 11],
    [11, 9, 8, 7, 9, 11, 14],
  ];

  const colorFor = (rank: number) => {
    if (rank <= 3) return 'bg-emerald-500';
    if (rank <= 7) return 'bg-amber-400';
    if (rank <= 10) return 'bg-orange-400';
    return 'bg-red-400';
  };

  // Sized by the container, not in fixed pixels. Fixed 36px cells came to ~328px
  // with gaps and padding, which overflows a 320px phone — and the page must
  // never scroll sideways. aspect-square keeps them square at any width.
  return (
    <div className="inline-block w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* Labelled, for the same reason the assistant answer is: this is drawn,
          not a screenshot of anyone's real account. */}
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/70">
        <MapPin size={14} className="text-brand-500" />
        <span className="text-xs font-medium text-slate-500">Example visibility grid</span>
      </div>
      <div className="p-5">
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5" aria-hidden="true">
        {grid.flat().map((rank, i) => (
          <div
            key={i}
            className={`aspect-square rounded-md sm:rounded-lg ${colorFor(rank)} flex items-center justify-center text-white text-[10px] sm:text-xs font-bold`}
          >
            {rank}
          </div>
        ))}
      </div>
      <p className="sr-only">
        A seven by seven grid of map points around a business, each showing its search rank at that
        point — first near the shop, falling into the teens at the edges of town.
      </p>
      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Top 3</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> 4–7</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> 11+</span>
      </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-slate-100 px-6 py-4" aria-label="Main navigation">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="SuperLocalSEO home">
            <img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-9 w-auto" />
          </Link>

          <div className="hidden sm:flex gap-4 items-center">
            <a href="#pricing" className="text-sm text-slate-600 hover:text-slate-900">Pricing</a>
            <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900">Sign in</Link>
            <Link to="/register" className="text-sm bg-brand-500 text-white px-4 py-2 rounded-lg hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
              Get started
            </Link>
          </div>

          <button
            className="sm:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <span className="block w-5 h-0.5 bg-current mb-1" />
            <span className="block w-5 h-0.5 bg-current mb-1" />
            <span className="block w-5 h-0.5 bg-current" />
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="sm:hidden pt-4 pb-2 space-y-2 border-t border-slate-100 mt-4">
            <a href="#pricing" className="block py-2 text-sm text-slate-700">Pricing</a>
            <Link to="/login" className="block py-2 text-sm text-slate-700">Sign in</Link>
            <Link to="/register" className="block py-2 text-sm font-medium text-brand-500">Get started free</Link>
          </div>
        )}
      </nav>

      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-brand-500 text-white px-4 py-2 rounded z-50">
        Skip to main content
      </a>

      <main id="main-content">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <img src="/hero-bg.jpg" alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-white/90" />

          <div className="relative z-10 max-w-6xl mx-auto px-6 pt-14 sm:pt-20 pb-16">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="text-center lg:text-left">
                <span className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 border border-brand-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 inline-block" />
                  For plumbers, HVAC, electrical &amp; roofing
                </span>

                <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-5 leading-[1.12]">
                  Your customers are asking AI who to call.
                  <span className="block text-brand-600">Does it say your name?</span>
                </h1>

                <p className="text-lg text-slate-600 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                  Every Monday we ask ChatGPT, Claude, Gemini and Perplexity the questions your customers
                  actually ask — and show you whether you were recommended, and who was recommended
                  instead. Your Google rankings, reviews and listings live in the same dashboard.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <a
                    href={INTEL_URL}
                    className="inline-block bg-brand-500 text-white text-base px-7 py-3.5 rounded-xl font-semibold hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                  >
                    Check my business free →
                  </a>
                  <Link
                    to="/register"
                    className="inline-block border border-slate-300 text-slate-700 text-base px-7 py-3.5 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>

                <p className="mt-4 text-sm text-slate-500">
                  Free report in about 2 minutes — no account. Trial needs no card.
                </p>
              </div>

              <div className="lg:pl-4">
                <AssistantAnswerMock />
              </div>
            </div>
          </div>
        </section>

        {/* ── What the free report tells you ───────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-16 sm:py-20" aria-labelledby="report-heading">
          <div className="text-center mb-12">
            <h2 id="report-heading" className="text-3xl font-bold text-slate-900 mb-3">
              Find out where you stand before you pay anything
            </h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              Give us your business name and city. We pull live data and email you the whole picture
              in about two minutes.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            {[
              {
                Icon: Sparkles,
                title: 'Whether AI recommends you',
                desc: 'We ask ChatGPT, Claude, Gemini and Perplexity for a business like yours in your town, and tell you if you were named — and where you came in the order.',
              },
              {
                Icon: Star,
                title: 'How your reputation reads',
                desc: 'Your rating, review count and how quickly you reply, plus the themes customers keep raising — the good ones and the ones costing you work.',
              },
              {
                Icon: MapPin,
                title: 'Who is beating you nearby',
                desc: 'The competitors showing up ahead of you locally, and an estimate of how much of the local search traffic each one is taking.',
              },
              {
                Icon: FileText,
                title: 'What to fix first',
                desc: 'The specific listings and gaps holding you back, ordered by what will move the needle soonest. No jargon.',
              },
            ].map(({ Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <Icon size={22} className="text-brand-500 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-1.5">{title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <a
              href={INTEL_URL}
              className="inline-block bg-brand-500 text-white px-8 py-3.5 rounded-xl font-semibold text-sm hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              Get my free report →
            </a>
            <p className="mt-3 text-xs text-slate-400">Free, no card needed.</p>
          </div>
        </section>

        {/* ── The full picture ─────────────────────────────────────────────── */}
        <section className="bg-slate-50 py-16 sm:py-20 px-6" aria-labelledby="picture-heading">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 id="picture-heading" className="text-3xl font-bold text-slate-900 mb-4">
                Being found isn't one number
              </h2>
              <p className="text-slate-600 leading-relaxed mb-5">
                You can rank first at your shop and vanish six streets away. Pro maps your position at
                every point on a grid across your service area, so you can see exactly where you
                disappear — and where the work you do next is actually worth doing.
              </p>
              <ul className="space-y-3 text-sm text-slate-600">
                {[
                  'Google rankings pulled daily and kept forever, so you can prove what changed and when',
                  'Reviews from every platform in one inbox, with a reply drafted for you in a click',
                  'Your listings re-checked every Monday, with anything out of date flagged',
                  'A plain-English report in your inbox on the 1st of each month',
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Check size={16} className="text-brand-500 shrink-0 mt-0.5" strokeWidth={3} />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-center">
              <GeoGridVisual />
            </div>
          </div>
        </section>

        {/* ── How we know ──────────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 py-16 sm:py-20" aria-labelledby="method-heading">
          <div className="text-center mb-10">
            <h2 id="method-heading" className="text-3xl font-bold text-slate-900 mb-3">How we know</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              Most tools in this category won't tell you how their numbers are produced. Here is
              exactly how ours are.
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                h: 'We picked the directories by measuring, not guessing',
                p: 'For a plumbing company we check 14 places — the 10 that matter for every local business, plus Angi, Houzz, Thumbtack and HomeAdvisor. We chose that list by testing candidate directories against real businesses and dropping any we found less than a quarter of the time. The ones that did not make the cut are recorded with the rate that got them dropped.',
              },
              {
                h: 'We re-check every Monday',
                p: 'Listings and AI answers move on the order of weeks, so that is the cadence. Rankings are pulled daily, because they move daily.',
              },
              {
                h: 'We keep every snapshot, forever',
                p: 'Every ranking, every listing check, every AI answer we have ever recorded for you stays available. Six months from now you can still show exactly what changed and when.',
              },
              {
                h: "When we don't know, we say so",
                p: 'If an assistant is unreachable, or your business name is too generic to tell apart from ordinary text, we mark that check "couldn\'t verify" rather than guessing. It is never counted against you and never quietly averaged into your score. A confident wrong answer is worse than an honest gap.',
              },
            ].map(({ h, p }) => (
              <div key={h} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-base font-semibold text-slate-900 mb-1.5">{h}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────── */}
        <section id="pricing" className="bg-slate-50 py-16 sm:py-20 px-6" aria-labelledby="pricing-heading">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 id="pricing-heading" className="text-3xl font-bold text-slate-900 mb-4">
              Less than one service call a month
            </h2>
            <p className="text-slate-600">
              An agency charges $1,500–5,000/mo to do this. Every trial starts free — no card, no
              setup fee, cancel anytime.
            </p>
          </div>

          <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Lite */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 h-full flex flex-col">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Lite</div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-5xl font-bold text-slate-900">${PRICING.lite}</span>
                <span className="text-slate-500 mb-1">/mo</span>
              </div>
              <p className="text-sm text-slate-500 mb-1">No setup fee</p>
              <p className="text-sm text-slate-500 mb-6">One location, and the answers that matter.</p>
              <ul className="space-y-3 mb-8 flex-1">
                {[
                  'Whether ChatGPT, Claude, Gemini and Perplexity recommend you',
                  'Daily rank tracking with full history',
                  'All your reviews in one place, with replies drafted for you',
                  'Review request campaigns by email and text',
                  'Monthly report in your inbox',
                  'Review widgets for your own website',
                ].map((f) => (
                  <li key={f} className="text-sm text-slate-600 flex gap-2">
                    <Check size={15} className="text-brand-500 shrink-0 mt-0.5" strokeWidth={3} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/register?plan=lite"
                className="block text-center py-3 rounded-lg font-semibold text-sm border border-brand-500 text-brand-600 hover:bg-brand-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Start 7-day free trial
              </Link>
              <p className="text-center text-xs text-slate-400 mt-3">No credit card required.</p>
            </div>

            {/* Pro */}
            <div className="bg-white rounded-2xl border-2 border-brand-500 shadow-lg p-8 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-brand-500 uppercase tracking-wide">Pro</span>
                <span className="bg-brand-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Most popular
                </span>
              </div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-5xl font-bold text-slate-900">${PRICING.pro}</span>
                <span className="text-slate-500 mb-1">/mo</span>
              </div>
              <p className="text-sm text-slate-500 mb-1">
                Setup fee <span className="line-through">${PRICING.setupFeeAnchor}</span>{' '}
                <span className="font-semibold text-brand-600">waived</span>
              </p>
              <p className="text-sm text-slate-500 mb-6">+${PRICING.extraLocation}/mo per additional location</p>
              <ul className="space-y-3 mb-8 flex-1">
                {[
                  'Everything in Lite',
                  'Who the AI assistants recommend instead of you',
                  'Which sources they trust — and which you can get listed on',
                  'The full answer behind every result, kept on file',
                  'Where you rank across your whole service area',
                  'Your listings checked weekly across the directories for your trade',
                  'Guided listing cleanup and submission',
                  'Competitor tracking and full site audits',
                  'Revenue attribution, team logins, QR codes, exports',
                ].map((f) => (
                  <li key={f} className="text-sm text-slate-700 flex gap-2 font-medium">
                    <Check size={15} className="text-brand-500 shrink-0 mt-0.5" strokeWidth={3} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/register?plan=pro"
                className="block text-center py-3 rounded-lg font-semibold text-sm bg-brand-500 text-white hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Start 7-day free trial
              </Link>
              <p className="text-center text-xs text-slate-400 mt-3">No credit card required.</p>
            </div>
          </div>

          <p className="text-center text-sm text-slate-500 mt-8">
            Start on Lite and upgrade anytime — no setup fee, ever.{' '}
            <a href={INTEL_URL} className="text-brand-500 hover:underline font-medium">
              Or check your business free first →
            </a>
          </p>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-6 py-16 sm:py-20" aria-labelledby="faq-heading">
          <div className="text-center mb-10">
            <h2 id="faq-heading" className="text-3xl font-bold text-slate-900 mb-3">Questions</h2>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-6">
            {faqs.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-slate-600">
            Still have questions?{' '}
            <a href="mailto:hello@superlocalseo.com" className="text-brand-500 hover:underline">Email us</a>
          </p>
        </section>
      </main>

      <footer className="border-t border-slate-100 py-8 px-6 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} SuperLocalSEO. All rights reserved.</p>
        <p className="mt-2 flex items-center justify-center gap-4 flex-wrap">
          <Link to="/privacy" className="hover:text-slate-900">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-slate-900">Terms of Service</Link>
          <a href="mailto:hello@superlocalseo.com" className="hover:text-slate-900">hello@superlocalseo.com</a>
        </p>
      </footer>
    </div>
  );
}
