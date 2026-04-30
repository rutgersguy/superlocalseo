import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-brand-500">SuperLocalSEO</span>
        <div className="flex gap-4 items-center">
          <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900">Sign in</Link>
          <Link to="/register" className="text-sm bg-brand-500 text-white px-4 py-2 rounded-lg hover:bg-brand-600">Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
          Local SEO that actually<br />shows up on the map
        </h1>
        <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
          Rankings, reviews, and citations in one dashboard. Automated monthly PDF reports
          delivered to your inbox. Built for plumbers, HVAC, and electricians.
        </p>
        <Link to="/register" className="inline-block bg-brand-500 text-white text-lg px-8 py-4 rounded-xl font-semibold hover:bg-brand-600 transition-colors">
          Start free 14-day trial
        </Link>
        <p className="mt-4 text-sm text-gray-500">No credit card required to start.</p>
      </section>

      {/* Value props */}
      <section className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          { title: 'Ranking Tracker', desc: 'Daily keyword rank tracking with full historical data. See exactly where you stand and how you\'re trending.' },
          { title: 'Review Monitor', desc: 'All your Google, Yelp, and review platform activity in one place. Never miss a new review.' },
          { title: 'Citation Health', desc: 'Know which directories list your business and whether your NAP data matches everywhere.' },
        ].map((item) => (
          <div key={item.title} className="p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.title}</h3>
            <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 py-20 px-6">
        <div className="max-w-4xl mx-auto text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Simple, location-based pricing</h2>
          <p className="text-gray-600">One price per location. Add locations as you grow.</p>
        </div>
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { name: 'Starter', price: '$350', locations: 1, extra: '$150', features: ['1 location included', 'Daily rank tracking', 'Review monitoring', 'Citation health', 'Monthly PDF report'] },
            { name: 'Growth', price: '$700', locations: 3, extra: '$100', features: ['3 locations included', 'Everything in Starter', 'Priority support', 'Trend analytics'] },
            { name: 'Pro', price: '$1,200', locations: 5, extra: '$75', features: ['5 locations included', 'Everything in Growth', 'Dedicated onboarding', 'Custom reporting'] },
          ].map((tier, i) => (
            <div key={tier.name} className={`p-8 rounded-2xl border ${i === 1 ? 'border-brand-500 shadow-lg' : 'border-gray-200'} bg-white`}>
              {i === 1 && <div className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-3">Most popular</div>}
              <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
              <div className="mt-4 mb-6">
                <span className="text-4xl font-bold text-gray-900">{tier.price}</span>
                <span className="text-gray-500">/mo</span>
                <p className="text-sm text-gray-500 mt-1">+{tier.extra}/mo per additional location</p>
              </div>
              <ul className="space-y-3 mb-8">
                {tier.features.map((f) => (
                  <li key={f} className="text-sm text-gray-600 flex items-center gap-2">
                    <span className="text-brand-500">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link to="/register" className={`block text-center py-3 rounded-lg font-semibold text-sm transition-colors ${i === 1 ? 'bg-brand-500 text-white hover:bg-brand-600' : 'border border-brand-500 text-brand-500 hover:bg-brand-50'}`}>
                Start free trial
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} SuperLocalSEO. All rights reserved.</p>
        <p className="mt-2">
          <a href="mailto:support@superlocalseo.com" className="hover:text-gray-900">support@superlocalseo.com</a>
        </p>
      </footer>
    </div>
  );
}
