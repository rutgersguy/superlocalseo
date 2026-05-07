import { Link } from 'react-router-dom';

const EFFECTIVE_DATE = 'May 7, 2026';
const CONTACT_EMAIL = 'support@superlocalseo.com';

export default function Terms() {
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
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-500 mb-12">Effective {EFFECTIVE_DATE}</p>

        <div className="prose prose-slate max-w-none space-y-10">

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Agreement</h2>
            <p className="text-slate-600 leading-relaxed">
              These Terms of Service ("Terms") govern your access to and use of the SuperLocalSEO
              platform, including all associated APIs, dashboards, reports, and related services
              (collectively, the "Service"). By creating an account or using the Service, you agree
              to be bound by these Terms and our{' '}
              <Link to="/privacy" className="text-brand-500 hover:underline">
                Privacy Policy
              </Link>
              . If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Eligibility</h2>
            <p className="text-slate-600 leading-relaxed">
              You must be at least 18 years old and have authority to bind the business entity
              on whose behalf you are using the Service. By accepting these Terms you represent
              that these conditions are met.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Accounts</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              You are responsible for maintaining the confidentiality of your account credentials.
              You are responsible for all activity that occurs under your account. Notify us
              immediately at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-500 hover:underline">
                {CONTACT_EMAIL}
              </a>{' '}
              if you suspect unauthorized access.
            </p>
            <p className="text-slate-600 leading-relaxed">
              You may invite team members to your account under your plan's seat allowance. You are
              responsible for ensuring all users you invite comply with these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Free Trial</h2>
            <p className="text-slate-600 leading-relaxed">
              New accounts receive a 14-day free trial with no credit card required. At the end of
              the trial period, you must select a paid plan to continue using the Service. Unused
              trial days do not carry over. We reserve the right to modify or discontinue the free
              trial at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Subscription &amp; Billing</h2>
            <h3 className="text-base font-medium text-slate-800 mb-2">5.1 Plans and Fees</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Paid plans are billed monthly in advance. Your subscription renews automatically on
              the same day each month unless you cancel before the renewal date. All fees are in
              US dollars.
            </p>
            <h3 className="text-base font-medium text-slate-800 mb-2">5.2 Additional Locations</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Each plan includes a base number of locations. Additional locations are billed as a
              monthly add-on at the per-location rate for your plan tier. Add-on charges are
              prorated for the remainder of the current billing cycle when a location is added
              mid-period.
            </p>
            <h3 className="text-base font-medium text-slate-800 mb-2">5.3 Payment Failure</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              If payment fails, we will retry up to three times over seven days. If all retries fail,
              your account will be suspended. Data is retained for 30 days after suspension, after
              which we may permanently delete it. You can reactivate by updating your payment method.
            </p>
            <h3 className="text-base font-medium text-slate-800 mb-2">5.4 Refunds</h3>
            <p className="text-slate-600 leading-relaxed">
              All fees are non-refundable except as required by applicable law. If you cancel mid-period
              your access continues through the end of the paid billing cycle; no partial refunds are
              issued. If you believe you were charged in error, contact us within 30 days of the charge.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Cancellation</h2>
            <p className="text-slate-600 leading-relaxed">
              You may cancel your subscription at any time from the Billing section of Settings.
              Cancellation takes effect at the end of your current billing period. We do not charge
              cancellation fees. After your access period ends you may request a data export within
              30 days before your data is deleted.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Acceptable Use</h2>
            <p className="text-slate-600 leading-relaxed mb-4">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
              <li>Use the Service to track or harm competitors through fraudulent reviews or false reports</li>
              <li>Attempt to reverse-engineer, scrape, or extract data from the platform beyond your authorized access</li>
              <li>Share your account credentials with individuals outside your organization</li>
              <li>Submit false or misleading business information that generates inaccurate data for third parties</li>
              <li>Use the Service in any way that violates Google's, Facebook's, or any other third-party platform's terms of service</li>
              <li>Attempt to circumvent the Service's rate limits, quotas, or authentication</li>
              <li>Use the platform for any purpose that is unlawful or prohibited by these Terms</li>
            </ul>
            <p className="text-slate-600 leading-relaxed mt-4">
              We reserve the right to suspend or terminate accounts that violate these restrictions
              without notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Third-Party Integrations</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              The Service integrates with Google Business Profile, Facebook, BrightLocal,
              EmbedMyReviews, and Stripe. By connecting these integrations you authorize us to
              access and use your data on those platforms as described in our Privacy Policy.
            </p>
            <p className="text-slate-600 leading-relaxed">
              We are not responsible for the availability, accuracy, or actions of third-party
              platforms. Changes to those platforms' APIs or policies may affect Service features.
              We will make reasonable efforts to adapt to such changes but cannot guarantee uninterrupted
              functionality.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Data &amp; Ownership</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              You retain full ownership of all business data you submit to the Service (business
              names, addresses, keywords, review text, etc.). By using the Service you grant us a
              limited, non-exclusive license to process and store that data for the purpose of
              delivering the Service to you.
            </p>
            <p className="text-slate-600 leading-relaxed">
              We own the platform, software, reports (as a format and structure), dashboards, and
              all underlying technology. Nothing in these Terms transfers intellectual property
              rights from us to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. AI-Generated Content</h2>
            <p className="text-slate-600 leading-relaxed">
              The Service may generate suggested review responses using AI. These suggestions are
              provided for your convenience only. You are solely responsible for reviewing,
              editing, and approving any content before publishing it. We make no representations
              about the accuracy or appropriateness of AI-generated suggestions for your
              specific business context.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Disclaimer of Warranties</h2>
            <p className="text-slate-600 leading-relaxed">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
              EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
              PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE,
              UNINTERRUPTED, OR THAT RANKING OR REVIEW DATA WILL BE ACCURATE OR COMPLETE. SEO
              RESULTS DEPEND ON MANY FACTORS OUTSIDE OUR CONTROL; WE MAKE NO GUARANTEE OF
              SPECIFIC RANKING IMPROVEMENTS.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">12. Limitation of Liability</h2>
            <p className="text-slate-600 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SUPERLOCALSEO AND ITS OFFICERS,
              EMPLOYEES, AND CONTRACTORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOSS OF PROFITS OR REVENUE, ARISING FROM YOUR
              USE OF THE SERVICE — EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL
              AGGREGATE LIABILITY TO YOU FOR ANY CLAIMS ARISING FROM THESE TERMS OR THE SERVICE
              SHALL NOT EXCEED THE FEES PAID BY YOU IN THE THREE MONTHS PRECEDING THE CLAIM.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">13. Indemnification</h2>
            <p className="text-slate-600 leading-relaxed">
              You agree to indemnify and hold harmless SuperLocalSEO, its officers, employees,
              and contractors from any claims, losses, liabilities, damages, and expenses (including
              reasonable attorneys' fees) arising from your use of the Service, your violation of
              these Terms, or your infringement of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">14. Termination</h2>
            <p className="text-slate-600 leading-relaxed">
              We may suspend or terminate your account at any time for violation of these Terms,
              non-payment, or for any other reason with reasonable notice. Upon termination for
              cause we are not required to refund any prepaid fees. You may terminate your account
              at any time by canceling your subscription and requesting account deletion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">15. Governing Law &amp; Disputes</h2>
            <p className="text-slate-600 leading-relaxed">
              These Terms are governed by the laws of the State of New Jersey, United States,
              without regard to conflict-of-law principles. Any disputes will be resolved through
              binding arbitration under the AAA Consumer Arbitration Rules, except that either
              party may seek injunctive or other equitable relief in any court of competent
              jurisdiction. You waive any right to participate in a class action lawsuit or
              class-wide arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">16. Changes to These Terms</h2>
            <p className="text-slate-600 leading-relaxed">
              We may update these Terms from time to time. When we make material changes, we will
              notify you by email at least 14 days before the changes take effect. Continued use of
              the Service after the effective date constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">17. Contact</h2>
            <p className="text-slate-600 leading-relaxed">
              Questions about these Terms? Email us at{' '}
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
