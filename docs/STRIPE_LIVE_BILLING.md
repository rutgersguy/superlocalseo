# Stripe live billing

## Preparation status — September 26, 2026

The Stripe account is `acct_1BbClXBjmrnTgLcA`. Payments are active following
representative verification. The owner subsequently reported updating the bank
details; payout capability still needs to be checked again. Enabling payments does
not prove that payouts work.

**The application remains in test mode.** Live credential installation, webhook
configuration, test-reference reconciliation, and the pilot promotion are pending.
Creating the live catalog does not activate application billing or charge anyone.

The following live products were created and their monthly USD prices checked
against the application. Leave the older 2019 products alone.

| Application setting | Product | Monthly price | Live product ID |
| --- | --- | ---: | --- |
| `STRIPE_BASE_PRICE_ID` | SuperLocalSEO Pro | $349 | `prod_VKZJaWxviejQbb` |
| `STRIPE_LITE_BASE_PRICE_ID` | SuperLocalSEO Lite | $149 | `prod_VKZJJkD0bWq2ef` |
| `STRIPE_LOCATION_PRICE_ID` | SuperLocalSEO Pro — Additional Location | $125 | `prod_VKZKBQIcdu89ym` |

These are **product IDs**, not values to put into the price settings. Retrieve each
product's active recurring price and verify the amount, currency, monthly interval,
and live mode before assigning its `price_...` ID. Keep setup fees disabled.

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

The September 26 read-only audit found six linked customers in test mode. Stephen's
subscription was an incomplete test subscription. Two other stored subscription
references could not be retrieved with the current test key; they require explicit
reconciliation rather than being treated as confirmed test subscriptions.

## Legacy Fitness pilot

The agreed price is **$1 USD/month for the ongoing one-location Pro subscription**.
Prepare a $348 USD amount-off coupon with `duration=forever`, restricted to the
current $349 Pro base product, and a promotion code restricted to Stephen's live
customer. Verify the resulting first invoice and recurring total before he pays.
Do not apply the discount to additional locations or Lite. Do not use the unrelated
legacy Demo Product $1. A future move to a different base price requires reviewing
the discount so the promised $1 recurring total is preserved.

Stephen enters his own card during the next session. Do not create a paid
subscription, charge a stored card, or submit directory orders as part of
administrative preparation. Keep the real trial expiration unchanged during the
mode transition unless the owner requests an extension.

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
