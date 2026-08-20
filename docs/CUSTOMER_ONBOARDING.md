# Customer Onboarding Workflow

Step-by-step guide for onboarding a new customer to SuperLocalSEO.

> **Working doc (Google Docs):** https://docs.google.com/document/d/1IWPIR5D6Um84f64Giitl_y8okV-gA8WwE6c2V4cYKgU/edit?usp=sharing

---

## 1. Register

- Go to `superlocalseo.com` → Sign Up
- Create account with email + password (or Google Sign-In)
- Verify email if prompted

---

## 2. Onboarding Wizard

### Step 1 — Business Info
- Enter business name and select industry
- Click **Next**

### Step 2 — Locations
- Add primary location (name, address, city, state, zip, phone)
- Each location is saved to the database immediately when added
- Add additional locations if applicable
- Click **Next**

### Step 3 — Keywords
- For each location, add target search terms (e.g. "HVAC repair in Dallas")
- Each keyword is saved to the database immediately when added
- 3–5 keywords per location to start
- The system also auto-seeds starter keywords from your industry when a location is first created

### Step 4 — Connect Platforms
- Click **Connect Google** and complete the OAuth flow — optional but strongly recommended (enables Google review sync and ranking data)
- **Facebook** — the card links to **Settings → Integrations** to connect after onboarding; no OAuth is required during the wizard
- Click **Finish** (all integrations can be connected later in Settings → Integrations)

---

## 3. After Clicking Finish (Automatic)

The following happen server-side when the customer clicks Finish:

- EMR review management sub-account is created and credentials are stored
- Citation scan is queued — results appear in the Citations tab within a few minutes
- Initial rankings pull is queued — first keyword positions appear within 24 hours
- Customer is redirected to the **Dashboard**

> **Billing:** The 7-day trial is already active — no payment is required. To subscribe early, go to Settings → Billing. The payment form appears automatically when ≤3 days remain or the trial has expired.

> **If EMR provisioning fails or times out:** The customer still proceeds to the dashboard normally — all other features (rankings, citations, reports) work immediately. The review management section will show a "still being set up" state until provisioning succeeds. See EMR failure handling below.


---

## 4. When Will I See Data?

| Data Type | When It Appears |
|---|---|
| Citation scan results | 2–5 minutes after onboarding |
| First keyword rankings | Within 24 hours (BrightLocal pull) |
| Review data (if GBP connected) | Within 1–2 hours of connecting |
| First monthly report | Day 32 (auto-generated on the 1st of the following month) |

---

## 5. Set Up Review Management (EMR)

> **Admin-only feature:** EMR credentials, the EMR provision banner, and the EMR section in Settings → Integrations are only visible to platform admin accounts (`role = 'admin'` in the `users` table). Regular client accounts do not see these elements.

> **What is `app.superlocalseo.com`?** This is SuperLocalSEO's white-labeled review management portal, powered by EmbedMyReviews. It is a separate application from the main SuperLocalSEO dashboard — customers log in with their own credentials and connect their review profiles there. Think of it as a companion tool, not a sub-page.

- (Admin only) An amber banner appears on the **Reviews** and **Campaigns** pages, or go to **Settings → Integrations**
- A modal displays their login credentials:
  - **Login URL:** `https://app.superlocalseo.com/login`
  - **Email:** their registered email address
  - **Password:** auto-generated (copy button provided)
- Customer logs into `app.superlocalseo.com/login` with those credentials
- Inside the portal, they connect their Google, Yelp, Facebook, and other review profiles
- Reviews sync hourly via the BullMQ job, or near-instantly via webhook for new reviews

---

## 6. Send a Test Review Request (Optional)

- Inside `app.superlocalseo.com`, create a campaign
- Send a review invite to a test contact
- Verify the email flow works end-to-end

---

## Operator Checklist (After Customer Onboards)

- [ ] Confirm location was added during onboarding (check admin panel or Settings → Locations); if missing, add via Settings → Locations
- [ ] Confirm keywords exist for each location (Settings → Keywords); if missing, add 3–5 target terms
- [ ] Confirm `emr_provisioning_status = provisioned` and `emr_customer_id` is populated in the admin panel
- [ ] If EMR credentials modal shows "still being set up":
  1. Check admin panel — if `emr_provisioning_status = failed`, use the **Retry Provision** button
  2. If retry fails, set `emr_provisioning_status = 'failed'` in DB and run `provisionClient(clientId)` via ts-node in the API container
  3. Customer can use all other dashboard features in the meantime — only review management is affected
- [ ] Confirm citation scan results are populating in the Citations tab
- [ ] Trial is auto-set to 7 days from registration — no manual action needed unless adjusting

---

## Pricing Reference

| Tier | Monthly Price | Included Locations | Extra Locations |
|---|---|---|---|
| **Lite** | $149/mo | 1 | not available on Lite |
| **Pro** | $349/mo | 1 | +$125/mo each |

- All tiers include every feature — no feature gating by tier
- Per-location billing is prorated; locations can be added or removed mid-month

---

## Known Issues / Bugs

- **EMR company name collision:** If two customers share the same business name, provisioning retries with `"Business Name (email@domain.com)"` as the company name in EMR automatically.
- **Google OAuth expiry:** GBP tokens expire and may need reconnection. Customer reconnects in Settings → Integrations.
- **deleteClientEMR not called on admin delete:** EMR sub-accounts are orphaned when a client is deleted via the admin panel. Manual cleanup in the EMR agency dashboard is required.
