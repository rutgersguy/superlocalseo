import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, TrendingUp, Star, MapPin } from 'lucide-react';

const faqs = [
  {
    q: 'How does the free trial work?',
    a: 'You get 14 days completely free — no credit card required to start. At the end of the trial, choose a plan that fits your business or cancel with no obligation.',
  },
  {
    q: 'What third-party tools do I need?',
    a: 'SuperLocalSEO connects directly to your Google Business Profile. During onboarding you can connect additional integrations to unlock reviews and citation monitoring.',
  },
  {
    q: 'Can I add locations over time?',
    a: 'Yes. Each plan includes a base number of locations and you can add more at any time. Additional locations are billed as a monthly add-on on top of your base plan.',
  },
  {
    q: 'What goes in the monthly PDF report?',
    a: 'Each report includes an executive summary, keyword ranking trends with deltas vs. the prior month, review volume and rating breakdown, citation health score, and a recommendations section. Reports are generated on the 1st of each month and emailed automatically.',
  },
  {
    q: 'Can I manage multiple clients?',
    a: 'SuperLocalSEO is built for a single agency or business owner managing their own locations. Multi-client white-label support is on the roadmap.',
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
    desc: 'Know which directories list your business and whether your NAP data matches everywhere.',
    Icon: MapPin,
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
            <span className="text-xl font-bold text-brand-500">SuperLocalSEO</span>
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
            <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 border border-brand-100">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 inline-block" />
              Built for home service businesses
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-6 leading-tight">
              Local SEO that actually<br className="hidden sm:block" />shows up on the map
            </h1>
            <p className="text-lg sm:text-xl text-slate-600 mb-10 max-w-2xl mx-auto">
              Rankings, reviews, and citations in one dashboard. Automated monthly PDF reports
              delivered to your inbox. Built for plumbers, HVAC, and electricians.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/audit"
                className="inline-block bg-brand-500 text-white text-lg px-8 py-4 rounded-xl font-semibold hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Get your free SEO audit
              </Link>
              <Link
                to="/register"
                className="inline-block border border-slate-300 text-slate-700 text-lg px-8 py-4 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
              >
                Start free trial
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">Free audit — no account needed. Trial requires no credit card.</p>
          </div>
        </section>

        {/* Social proof strip */}
        <div className="border-y border-slate-100 bg-slate-50/60 py-5 px-6 text-center text-sm text-slate-500">
          Trusted by plumbers, HVAC contractors, and electricians to track their local rankings every day.
        </div>

        {/* Value props */}
        <section className="max-w-5xl mx-auto px-6 py-12 sm:py-16" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-2xl font-bold text-slate-900 text-center mb-10">Everything you need to rank locally</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
            {featureCards.map(({ title, desc, Icon }) => (
              <div key={title} className="p-6 rounded-2xl border border-slate-100 shadow-sm">
                <Icon size={24} className="text-brand-500 mb-3" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="bg-slate-50 py-16 sm:py-20 px-6" aria-labelledby="pricing-heading">
          <div className="max-w-4xl mx-auto text-center mb-12">
            <h2 id="pricing-heading" className="text-3xl font-bold text-slate-900 mb-4">Simple, location-based pricing</h2>
            <p className="text-slate-600">One price per location. Add locations as you grow.</p>
          </div>
          <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { name: 'Starter', price: '$350', extra: '$150', features: ['1 location included', 'Daily rank tracking', 'Review monitoring', 'Citation health', 'Monthly PDF report'] },
              { name: 'Growth', price: '$700', extra: '$100', features: ['3 locations included', 'Everything in Starter', 'Priority support', 'Trend analytics'] },
              { name: 'Pro', price: '$1,200', extra: '$75', features: ['5 locations included', 'Everything in Growth', 'Dedicated onboarding', 'Custom reporting'] },
            ].map((tier, i) => (
              <div key={tier.name} className={`p-8 rounded-2xl border ${i === 1 ? 'border-brand-500 shadow-lg' : 'border-slate-200'} bg-white`}>
                {i === 1 && <div className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-3" aria-label="Most popular plan">Most popular</div>}
                <h3 className="text-xl font-bold text-slate-900">{tier.name}</h3>
                <div className="mt-4 mb-6">
                  <span className="text-4xl font-bold text-slate-900">{tier.price}</span>
                  <span className="text-slate-500">/mo</span>
                  <p className="text-sm text-slate-500 mt-1">+{tier.extra}/mo per additional location</p>
                </div>
                <ul className="space-y-3 mb-8" aria-label={`${tier.name} plan features`}>
                  {tier.features.map((f) => (
                    <li key={f} className="text-sm text-slate-600 flex items-center gap-2">
                      <span className="text-brand-500" aria-hidden="true">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={`block text-center py-3 rounded-lg font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${i === 1 ? 'bg-brand-500 text-white hover:bg-brand-600' : 'border border-brand-500 text-brand-500 hover:bg-brand-50'}`}
                >
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
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
            <a href="mailto:support@superlocalseo.com" className="text-brand-500 hover:underline">
              Email us
            </a>
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8 px-6 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} SuperLocalSEO. All rights reserved.</p>
        <p className="mt-2">
          <a href="mailto:support@superlocalseo.com" className="hover:text-slate-900">support@superlocalseo.com</a>
        </p>
      </footer>
    </div>
  );
}
