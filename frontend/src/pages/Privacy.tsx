import { Link } from 'react-router-dom';

const EFFECTIVE_DATE = 'May 7, 2026';
const CONTACT_EMAIL = 'hello@superlocalseo.com';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <header className="border-b border-slate-100 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="font-bold text-lg text-slate-900 hover:text-brand-500 transition-colors">
            SuperLocalSEO
          </Link>
          <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900">
            Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-12">Effective {EFFECTIVE_DATE}</p>

        <div className="prose prose-slate max-w-none space-y-10">

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Overview</h2>
            <p className="text-slate-600 leading-relaxed">
              SuperLocalSEO ("we," "our," or "us") operates the SuperLocalSEO platform, a local SEO
              management service. This Privacy Policy explains what data we collect, how we use it,
              and your rights as a user. By using our platform you agree to the practices described here.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Information We Collect</h2>
            <h3 className="text-base font-medium text-slate-800 mb-2">Account &amp; Billing Data</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              When you register we collect your name, email address, and password (stored as a bcrypt
              hash — never in plain text). If you subscribe to a paid plan, billing is handled by
              Stripe; we store only the Stripe customer ID and last-four card digits on our side.
              Your full card number never touches our servers.
            </p>
            <h3 className="text-base font-medium text-slate-800 mb-2">Business &amp; Location Data</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              To provide ranking, review, and citation services we collect the business name, address,
              phone number, website URL, and keywords you enter. This data is submitted to third-party
              SEO data providers (BrightLocal, EmbedMyReviews) on your behalf to generate reports.
            </p>
            <h3 className="text-base font-medium text-slate-800 mb-2">Third-Party OAuth Tokens</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              When you connect Google Business Profile or Facebook Pages, we store the OAuth access
              token and refresh token returned by those platforms. These tokens are encrypted at rest
              using AES-256-GCM and used solely to fetch your reviews and business data.
            </p>
            <h3 className="text-base font-medium text-slate-800 mb-2">Usage &amp; Log Data</h3>
            <p className="text-slate-600 leading-relaxed">
              We collect standard server logs (IP address, browser, pages visited, timestamps) for
              security monitoring and debugging. We do not sell or share log data with advertisers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
              <li>Provide, operate, and improve the SuperLocalSEO platform</li>
              <li>Fetch ranking data, review data, and citation audits from our data partners on your behalf</li>
              <li>Generate automated monthly PDF reports and dashboard analytics</li>
              <li>Send transactional emails (billing receipts, password resets, review alerts)</li>
              <li>Detect and prevent fraud, abuse, or unauthorized access</li>
              <li>Comply with legal obligations</li>
            </ul>
            <p className="text-slate-600 leading-relaxed mt-4">
              We do not sell your personal data or business data to third parties. We do not use your
              data to train machine learning models for any purpose other than providing you with
              AI-generated review responses within the platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Third-Party Services</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              We share data with the following service providers only to the extent necessary to
              operate the platform:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 pr-6 font-semibold text-slate-700">Provider</th>
                    <th className="text-left py-2 pr-6 font-semibold text-slate-700">Purpose</th>
                    <th className="text-left py-2 font-semibold text-slate-700">Data shared</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-6 font-medium">Stripe</td>
                    <td className="py-3 pr-6">Payment processing</td>
                    <td className="py-3">Name, email, billing address</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-6 font-medium">BrightLocal</td>
                    <td className="py-3 pr-6">Rank tracking &amp; citation audits</td>
                    <td className="py-3">Business name, address, phone, keywords</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-6 font-medium">EmbedMyReviews</td>
                    <td className="py-3 pr-6">Review aggregation &amp; widgets</td>
                    <td className="py-3">Business name, location data</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-6 font-medium">Google / Facebook</td>
                    <td className="py-3 pr-6">Review &amp; profile sync</td>
                    <td className="py-3">OAuth tokens (via your authorization)</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-6 font-medium">Anthropic / OpenAI</td>
                    <td className="py-3 pr-6">AI review response generation</td>
                    <td className="py-3">Review text submitted for response drafting</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Data Retention</h2>
            <p className="text-slate-600 leading-relaxed">
              We retain your account data for as long as your account is active. If you cancel and
              request deletion, we delete your personal data within 30 days, except where retention
              is required by law (e.g., billing records for tax compliance, retained for 7 years).
              Ranking and review history data associated with your account is deleted along with your
              account on request.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Security</h2>
            <p className="text-slate-600 leading-relaxed">
              All data is transmitted over TLS. Passwords are hashed with bcrypt. OAuth tokens are
              encrypted at rest with AES-256-GCM. We perform regular dependency audits and apply
              security patches promptly. No system is perfectly secure; please use a strong, unique
              password and contact us immediately if you suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Cookies</h2>
            <p className="text-slate-600 leading-relaxed">
              We use a single HTTP-only, Secure session cookie to maintain your authenticated session.
              We do not use tracking cookies, advertising cookies, or third-party analytics cookies.
              The Crisp live-chat widget (if enabled) may set its own cookies governed by Crisp's
              privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Your Rights</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              Depending on your location you may have the right to:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data ("right to be forgotten")</li>
              <li>Export your data in a portable format</li>
              <li>Withdraw consent for data processing (this may affect your ability to use the platform)</li>
            </ul>
            <p className="text-slate-600 leading-relaxed mt-4">
              To exercise any of these rights, email us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-500 hover:underline">
                {CONTACT_EMAIL}
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Children's Privacy</h2>
            <p className="text-slate-600 leading-relaxed">
              SuperLocalSEO is a business-to-business service. We do not knowingly collect personal
              data from individuals under 18. If you believe a minor has created an account, please
              contact us and we will delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. Changes to This Policy</h2>
            <p className="text-slate-600 leading-relaxed">
              We may update this Privacy Policy from time to time. When we do, we'll update the
              "Effective" date at the top and, for material changes, send an email notification to
              registered users. Continued use of the platform after changes become effective
              constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Contact</h2>
            <p className="text-slate-600 leading-relaxed">
              Questions about this policy? Email us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-500 hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-100 py-8 px-6 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} SuperLocalSEO. All rights reserved.</p>
        <p className="mt-2 flex items-center justify-center gap-4">
          <Link to="/privacy" className="hover:text-slate-900">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-slate-900">Terms of Service</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-900">{CONTACT_EMAIL}</a>
        </p>
      </footer>
    </div>
  );
}
