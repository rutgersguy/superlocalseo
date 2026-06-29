import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, TrendingUp, Star, MapPin, MessageSquare, Users, FileText, DollarSign, Shield, Trophy, Cpu, Heart } from 'lucide-react';

const INTEL_URL = 'https://app.superlocalseo.com/intel-request';

const reportPreviewCards = [
  {
    Icon: Shield,
    title: 'Trust Score & Google Profile',
    desc: 'Your star rating, review count, response rate, and an A–F grade that tells you exactly where you stand.',
  },
  {
    Icon: Trophy,
    title: 'Live Market Battle',
    desc: "How you stack up against your 5 nearest competitors — with click share estimates showing who's winning local searches.",
  },
  {
    Icon: Cpu,
    title: 'AI Visibility Check',
    desc: 'Whether ChatGPT, Gemini, and Perplexity recommend your business when a customer asks for a local contractor.',
  },
  {
    Icon: Heart,
    title: 'What Customers Are Saying',
    desc: 'AI-powered sentiment analysis of your reviews — the themes customers love and the ones they keep complaining about.',
  },
];

const faqs = [
  {
    q: 'What is the free local visibility report?',
    a: 'It\'s a no-strings snapshot of your business on Google — your trust score, how you rank against local competitors by click share, what customers are saying in your reviews, and whether AI tools like ChatGPT and Gemini recommend your business when someone asks. Enter your business name and city and we\'ll email the full report in about 2 minutes. No account, no credit card.',
  },
  {
    q: 'How does the free trial work?',
    a: 'You get 15 days completely free — no credit card required to start. Trials run with full Pro access so you can try everything. At checkout you choose the plan that fits — Lite ($99/mo) or Pro ($349/mo) — and that\'s when billing begins. If you don\'t subscribe, access is paused until you do.',
  },
  {
    q: 'What\'s the difference between Lite and Pro?',
    a: 'Lite ($99/mo) covers the essentials for a single location — daily rank tracking, review monitoring with AI responses, review request campaigns, and a monthly PDF report. Pro ($349/mo) adds citation building, geo-grid visibility heatmaps, competitor intelligence, full SEO audits, ROI attribution, team members, QR codes, CSV exports, and lets you add more locations ($125/mo each). Neither plan has a setup fee, and you can start on Lite and upgrade to Pro anytime.',
  },
  {
    q: 'What do I need to get started?',
    a: 'Just your business info and a Google account. During onboarding you connect your Google Business Profile to unlock review monitoring. Rank tracking and citation monitoring activate automatically — no extra tools or accounts needed on your end.',
  },
  {
    q: 'Can I add locations over time?',
    a: 'Yes, on the Pro plan. Each plan includes 1 location; on Pro you can add more for $125/mo each, billed immediately on a prorated basis for the rest of your current billing cycle. Lite covers a single location — upgrade to Pro when you\'re ready to add more.',
  },
  {
    q: 'What goes in the monthly PDF report?',
    a: 'Each report includes an executive summary, keyword ranking trends with deltas vs. the prior month, review volume and rating breakdown, citation health score, and a recommendations section. Reports are generated on the 1st of each month and emailed automatically.',
  },
  {
    q: 'Can I add team members?',
    a: 'Yes, on the Pro plan. You can invite team members with different permission levels — Owner, Admin, or Viewer. Admins can send review invites and manage settings; Viewers get read-only access to all dashboard data. No extra charge per seat. Team members are a Pro feature.',
  },
  {
    q: 'Is my data secure?',
    a: 'All third-party API keys are stored with AES-256-GCM encryption. Traffic is served over TLS. Passwords are hashed with bcrypt. We never store raw API credentials in plain text.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        className="w-full flex items-center justify-between py-5 text-left text-slate-900 font-medium text-sm hover:text-brand-500 transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {q}
        <ChevronDown
          size={18}
          className={`flex-shrink-0 ml-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <p className="pb-5 text-sm text-slate-600 leading-relaxed">{a}</p>}
    </div>
  );
}

const featureCards = [
  {
    title: 'Ranking Tracker',
    desc: "Daily keyword rank tracking with full historical data. See exactly where you stand and how you're trending.",
    Icon: TrendingUp,
  },
  {
    title: 'Review Monitor',
    desc: 'All your Google, Yelp, and review platform activity in one place. Never miss a new review.',
    Icon: Star,
  },
  {
    title: 'Citation Health',
    desc: 'Know which directories list your business and whether your business data matches everywhere.',
    Icon: MapPin,
  },
  {
    title: 'AI Review Responses',
    desc: 'One click and AI drafts a personalized, on-brand reply to any review. Edit, approve, and copy to the platform.',
    Icon: MessageSquare,
  },
  {
    title: 'Review Request Campaigns',
    desc: 'Send bulk review invites by email or SMS. Happy customers go to Google. Unhappy ones go to a private feedback form.',
    Icon: Users,
  },
  {
    title: 'Automated Monthly Reports',
    desc: 'A PDF report lands in your inbox on the 1st of every month — rankings, reviews, citations, and recommendations.',
    Icon: FileText,
  },
  {
    title: 'ROI & Revenue Attribution',
    desc: 'See the estimated monthly revenue impact of your keyword rankings based on search volume and your average customer value.',
    Icon: DollarSign,
  },
  {
    title: 'Competitor Benchmarking',
    desc: "Track competitors' Google ratings and review counts. See exactly where you rank in your local market.",
    Icon: TrendingUp,
  },
];

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

          {/* Desktop nav */}
          <div className="hidden sm:flex gap-4 items-center">
            <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900">Sign in</Link>
            <Link to="/register" className="text-sm bg-brand-500 text-white px-4 py-2 rounded-lg hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
              Get started
            </Link>
          </div>

          {/* Mobile hamburger */}
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

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden pt-4 pb-2 space-y-2 border-t border-slate-100 mt-4">
            <Link to="/login" className="block py-2 text-sm text-slate-700">Sign in</Link>
            <Link to="/register" className="block py-2 text-sm font-medium text-brand-500">Get started free</Link>
          </div>
        )}
      </nav>

      {/* Skip to main */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-brand-500 text-white px-4 py-2 rounded z-50">
        Skip to main content
      </a>

      <main id="main-content">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <img
            src="/hero-bg.jpg"
            alt="Business owner discussing local search rankings"
            className="absolute inset-0 w-full h-full object-cover object-center"
            aria-hidden="false"
          />
          <div className="absolute inset-0 bg-white/85" />
          <div className="relative z-10 max-w-4xl mx-auto px-6 pt-16 sm:pt-24 pb-16 text-center">
            <a
              href={INTEL_URL}
              className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 border border-brand-100 hover:bg-brand-100 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 inline-block" />
              Free local visibility report — no card needed →
            </a>
            <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-6 leading-tight">
              Local SEO that actually<br className="hidden sm:block" />{' '}shows up on the map
            </h1>
            <p className="text-lg sm:text-xl text-slate-600 mb-10 max-w-2xl mx-auto">
              Rankings, reviews, and AI visibility in one dashboard. See how you stack up against
              local competitors — free report in 2 minutes, then track it every day.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href={INTEL_URL}
                className="inline-block bg-brand-500 text-white text-lg px-8 py-4 rounded-xl font-semibold hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Get my free visibility report
              </a>
              <Link
                to="/register"
                className="inline-block border border-slate-300 text-slate-700 text-lg px-8 py-4 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
              >
                Start free trial
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">Free report — no account needed. Trial requires no credit card.</p>
          </div>
        </section>

        {/* Social proof strip */}
        <div className="border-y border-slate-100 bg-slate-50/60 py-5 px-6 text-center text-sm text-slate-500">
          Trusted by local businesses across every industry to track their rankings every day.
        </div>

        {/* Report preview */}
        <section className="max-w-5xl mx-auto px-6 py-14 sm:py-20" aria-labelledby="report-preview-heading">
          <div className="text-center mb-10">
            <h2 id="report-preview-heading" className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
              See exactly where you stand before you commit
            </h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              Your free local visibility report pulls live Google data on your business in about 2 minutes — no account needed.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            {reportPreviewCards.map(({ Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-brand-100 bg-brand-50/40 shadow-sm">
                <Icon size={24} className="text-brand-500 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <a
              href={INTEL_URL}
              className="inline-block bg-brand-500 text-white px-8 py-3 rounded-xl font-semibold text-sm hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              Get my free report →
            </a>
            <p className="mt-3 text-xs text-slate-400">Free, no card needed. Ready in about 2 minutes.</p>
          </div>
        </section>

        {/* Value props */}
        <section className="max-w-5xl mx-auto px-6 py-12 sm:py-16" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-2xl font-bold text-slate-900 text-center mb-10">Everything you need to rank locally</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featureCards.map(({ title, desc, Icon }) => (
              <div key={title} className="p-6 rounded-2xl border border-slate-100 shadow-sm">
                <Icon size={24} className="text-brand-500 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="bg-slate-50 py-16 sm:py-20 px-6" aria-labelledby="pricing-heading">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 id="pricing-heading" className="text-3xl font-bold text-slate-900 mb-4">Simple, transparent pricing</h2>
            <p className="text-slate-600">Start lean with Lite, or unlock the full suite with Pro. Every trial starts free — no credit card.</p>
          </div>
          <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Lite */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 h-full flex flex-col">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Lite</div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-5xl font-bold text-slate-900">$99</span>
                <span className="text-slate-500 mb-1">/mo</span>
              </div>
              <p className="text-sm text-slate-500 mb-1">No setup fee</p>
              <p className="text-sm text-slate-500 mb-6">The essentials to track and grow your local presence.</p>
              <ul className="space-y-3 mb-8 flex-1">
                {[
                  '1 location',
                  'Daily rank tracking',
                  'Review monitoring + AI responses',
                  'Review request campaigns',
                  'Monthly PDF report',
                  'Email support',
                ].map((f) => (
                  <li key={f} className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="text-brand-500" aria-hidden="true">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/register?plan=lite"
                className="block text-center py-3 rounded-lg font-semibold text-sm border border-brand-500 text-brand-600 hover:bg-brand-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Start with Lite
              </Link>
              <p className="text-center text-xs text-slate-400 mt-3">No credit card required to start.</p>
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
                <span className="text-5xl font-bold text-slate-900">$349</span>
                <span className="text-slate-500 mb-1">/mo</span>
              </div>
              <p className="text-sm text-slate-500 mb-1">
                Setup fee <span className="line-through">$499</span>{' '}
                <span className="font-semibold text-brand-600">waived</span>
              </p>
              <p className="text-sm text-slate-500 mb-6">+$125/mo per additional location</p>
              <ul className="space-y-3 mb-8 flex-1">
                {[
                  { label: 'Everything in Lite', pro: true },
                  { label: 'Citation building & health monitoring', pro: true },
                  { label: 'Geo-grid visibility heatmaps', pro: true },
                  { label: 'Competitor benchmarking & intelligence', pro: true },
                  { label: 'Full local SEO audits', pro: true },
                  { label: 'ROI & revenue attribution', pro: true },
                  { label: 'Team members & roles', pro: true },
                  { label: 'QR code review capture', pro: true },
                  { label: 'CSV exports', pro: true },
                  { label: 'Add locations — $125/mo each', pro: true },
                ].map(({ label, pro }) => (
                  <li
                    key={label}
                    className={`text-sm flex items-center gap-2 ${pro ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
                  >
                    <span className="text-brand-500" aria-hidden="true">✓</span> {label}
                  </li>
                ))}
              </ul>
              <Link
                to="/register?plan=pro"
                className="block text-center py-3 rounded-lg font-semibold text-sm bg-brand-500 text-white hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Start 15-day free trial
              </Link>
              <p className="text-center text-xs text-slate-400 mt-3">No credit card required to start.</p>
            </div>
          </div>
          <p className="text-center text-xs text-slate-500 mt-8">
            Start on Lite and upgrade to Pro anytime — no setup fee, ever.{' '}
            <a href={INTEL_URL} className="text-brand-500 hover:underline">
              Or get your free local visibility report first →
            </a>
          </p>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-6 py-16 sm:py-20" aria-labelledby="faq-heading">
          <div className="text-center mb-12">
            <h2 id="faq-heading" className="text-3xl font-bold text-slate-900 mb-4">Frequently asked questions</h2>
            <p className="text-slate-600">Everything you need to know before getting started.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-6">
            {faqs.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-slate-600">
            Still have questions?{' '}
            <a href="mailto:hello@superlocalseo.com" className="text-brand-500 hover:underline">
              Email us
            </a>
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8 px-6 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} SuperLocalSEO. All rights reserved.</p>
        <p className="mt-2 flex items-center justify-center gap-4">
          <Link to="/privacy" className="hover:text-slate-900">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-slate-900">Terms of Service</Link>
          <a href="mailto:hello@superlocalseo.com" className="hover:text-slate-900">hello@superlocalseo.com</a>
        </p>
      </footer>
    </div>
  );
}
