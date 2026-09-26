# Stripe live billing

## Live status — September 26, 2026

The Stripe account is `acct_1BbClXBjmrnTgLcA`. Following representative verification
and the owner's bank update, Stripe's Account Status page confirms **Payments and
Payouts are active**, with no active tasks remaining. This confirms capabilities;
real-payment acceptance still remains below.

**The production application now uses live Stripe billing.** Live credentials,
prices, webhook signing, the customer portal, and the pilot promotion are installed
and verified. No customer was subscribed or charged during this setup. The cutover
used GitHub commit `3890ee7ac27cdf0c28b08269ca373d23ec3e726a`
([preparation PR #236](https://github.com/rutgersguy/superlocalseo/pull/236)).

The following live products were created and their monthly USD prices checked
against the application. Leave the older 2019 products alone.

| Application setting | Product | Monthly price | Live price ID |
| --- | --- | ---: | --- |
| `STRIPE_BASE_PRICE_ID` | SuperLocalSEO Pro | $349 | `price_1UJuAiBjmrnTgLcA1YQslnM8` |
| `STRIPE_LITE_BASE_PRICE_ID` | SuperLocalSEO Lite | $149 | `price_1UJuB6BjmrnTgLcAqUOpQBYE` |
| `STRIPE_LOCATION_PRICE_ID` | SuperLocalSEO Pro — Additional Location | $125 | `price_1UJuBYBjmrnTgLcAPxof9Tu7` |

The matching products are `prod_VKZJaWxviejQbb` (Pro), `prod_VKZJJkD0bWq2ef`
(Lite), and `prod_VKZKBQIcdu89ym` (additional location). The running API verified
each live price's amount, currency, and monthly interval. Setup fees remain disabled.

The live webhook is `we_1UJvjbBjmrnTgLcAuQoF60Ai`, using API version `2024-06-20`.
The active default portal configuration is `bpc_1UJvjbBjmrnTgLcAz3TDA1GT`; it allows
invoice history, payment-method updates, and cancellation at the period end. Plan
changes stay in the application so subscription metadata remains consistent.

## Cutover procedure

1. Confirm the owner has completed Stripe's live-key verification. Transfer keys
   through a private local/server file, never through GitHub, chat, shell arguments,
   command output, or logs. Back up the production environment file with root-only
   permissions before replacing it.
2. Use the live API to confirm the expected account, payment capability, products,
   and prices. The browser's account status alone does not establish that a key
   belongs to that account. Set the live publishable and secret keys together.
3. Register the live webhook at
   `https://superlocalseo.com/api/billing/webhook`. The deployed Stripe SDK is
   **16.12.0**, which uses **2024-06-20**. Pin that webhook API version to match the
   subscription/invoice fields the handlers consume. Do not silently use Stripe's
   newest default API version; a future SDK upgrade requires reviewing both.
4. Subscribe only to the handled events: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_succeeded`, and `invoice.payment_failed`. Store this live
   endpoint's signing secret. A test endpoint's secret is not interchangeable.
5. Back up the database and inspect every stored customer/subscription reference
   under the old test credentials. Record object IDs and the result privately.
   `cus_...` and `sub_...` prefixes do not identify the mode. A missing object is not
   proof of a test object: check the live account as well before classifying it.
6. Reconcile test references during a controlled API maintenance window so a
   simultaneous checkout cannot create a new test reference during the switch.
   Archive the original values and preserve account creation dates, legitimate
   trial dates, and administrator access. Do not promote test subscriptions to
   paid live subscriptions or migrate test payment methods.
7. Publish reviewed configuration/documentation changes through GitHub and deploy
   from that commit. Recreate only the application containers with `--no-deps`;
   never use `docker compose down`. No database schema migration is required merely
   to replace Stripe environment values.
8. Verify running key modes without printing credentials, live price amounts, the
   public website/API, and the live webhook configuration. A healthy HTTP response
   is not proof of a successful live payment.

The audit found six linked test customers, one incomplete test subscription for
Stephen, and two subscription references absent from both the old test account and
the live account. After a dry run and verified database/environment backups, a
transaction reconciled those references while the API was stopped. Stephen's new
live customer is linked; other accounts create their live customer when needed.
One non-administrator demo account with no valid paid subscription returned to
trial status. Administrator access, registration dates, and existing trial dates
were preserved. The previous application test webhook was disabled.

## Legacy Fitness pilot

The agreed price is **$1 USD/month for the ongoing one-location Pro subscription**.
The $348 USD amount-off coupon with `duration=forever` is prepared, restricted to the
current $349 Pro base product, with a promotion code restricted to Stephen's live
customer. Both first-invoice and recurring-invoice live previews returned **$1.00**.
A recurring preview with one extra location returned **$126.00**, confirming that
the extra location remains $125. The application also successfully validated the
promotion through its running Stripe service. The code has no redemption-count cap
so restarting an incomplete checkout cannot exhaust it; its customer restriction
prevents other accounts from using it.
Do not apply the discount to additional locations or Lite. Do not use the unrelated
legacy Demo Product $1. A future move to a different base price requires reviewing
the discount so the promised $1 recurring total is preserved.

Stephen enters his own card during the next session. Do not create a paid
subscription, charge a stored card, or submit directory orders as part of
administrative preparation. Keep the real trial expiration unchanged during the
mode transition unless the owner requests an extension. Stephen's preserved trial
ends **October 3, 2026 at 6:14 a.m. America/Chicago**.

## Deployment verification

- Public website HTTP 200, API validation HTTP 422, and no API startup errors.
- Running secret/publishable keys both live; payments and payouts enabled for the
  expected account; all configured prices verified against Stripe.
- Every remaining customer reference resolves to a live customer. Stephen remains
  on his trial, with no live subscription created during preparation.
- An intentionally harmless, signed `customer.created` probe returned HTTP 200;
  an invalid signature returned HTTP 400. This checks signature handling without
  changing subscription state. It is **not** proof of Stripe-delivered payment
  events, which remain part of customer acceptance.
- The active default customer portal and customer/product restrictions on the
  ongoing pilot discount were checked through the live API.

## Acceptance still required

- Stephen can sign in and open billing without stale test-customer/subscription
  errors; the promotion produces a $1 recurring base charge and no setup fee.
- His authorized live payment succeeds, Stripe delivers the actual signed
  webhook, and the application records the current active Pro subscription.
- The invoice and next renewal agree with the promised ongoing price.
- The billing portal opens the same live customer and displays the subscription.
- Only after a successful nonzero live payment may listing submission be approved.
  Business details and the selected directories still need confirmation; payment
  alone does not place an order. See [listing policy](LISTING_SUBMISSION_POLICY.md).

Sandbox rehearsals and mock events do not fulfill these live acceptance checks.
If rollback is needed after real transactions exist, reconcile those transactions
first; do not blindly restore test credentials and overwrite newer billing records.

## References

- [Stripe go-live checklist](https://docs.stripe.com/get-started/checklist/go-live)
- [Stripe API keys](https://docs.stripe.com/keys)
- [Stripe webhook endpoints](https://docs.stripe.com/webhooks)
- [Stripe invoice previews](https://docs.stripe.com/api/invoices/upcoming?api-version=2024-06-20)
