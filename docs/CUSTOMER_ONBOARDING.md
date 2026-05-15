# Customer Onboarding Workflow

Step-by-step guide for onboarding a new customer to SuperLocalSEO.

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
- Add additional locations if applicable
- Click **Next**

### Step 3 — Keywords
- For each location, add target search terms (e.g. "HVAC repair in Dallas")
- 3–5 keywords per location to start
- Stuck? Click **Suggest Keywords** — the system generates relevant terms based on your business name and industry automatically

### Step 4 — Connect Google Business Profile
- Click **Connect Google** and complete the OAuth flow
- Optional but strongly recommended — enables Google review sync and ranking data
- Click **Finish** (can skip Google and connect later in Settings → Integrations)

---

## 3. After Clicking Finish (Automatic)

The following happen server-side when the customer clicks Finish:

- EMR review management sub-account is created and credentials are stored
- Citation scan is queued — results appear in the Citations tab within a few minutes
- Customer is redirected to the billing page to select a plan

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

> **What is `app.superlocalseo.com`?** This is SuperLocalSEO's white-labeled review management portal, powered by EmbedMyReviews. It is a separate application from the main SuperLocalSEO dashboard — customers log in with their own credentials and connect their review profiles there. Think of it as a companion tool, not a sub-page.

- An amber banner appears on the **Reviews** and **Campaigns** pages, or click **Review Management** in the header or go to **Settings → Integrations**
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

- [ ] Confirm `emr_provisioning_status = provisioned` and `emr_customer_id` is populated in the admin panel
- [ ] If EMR credentials modal shows "still being set up":
  1. Check admin panel — if `emr_provisioning_status = failed`, use the **Retry Provision** button
  2. If retry fails, set `emr_provisioning_status = 'failed'` in DB and run `provisionClient(clientId)` via ts-node in the API container
  3. Customer can use all other dashboard features in the meantime — only review management is affected
- [ ] Confirm citation scan results are populating in the Citations tab
- [ ] Confirm billing plan is set (or manually set trial via admin panel)

---

## Pricing Reference

| Tier | Monthly Price | Included Locations | Extra Locations |
|---|---|---|---|
| **Starter** | $350/mo | 1 | +$150/mo each |
| **Growth** | $700/mo | 3 | +$100/mo each |
| **Scale** | $1,200/mo | 5 | +$75/mo each |

- All tiers include every feature — no feature gating by tier
- Per-location billing is prorated; locations can be added or removed mid-month

---

## Known Issues

- **EMR company name collision:** If two customers share the same business name, provisioning retries with `"Business Name (email@domain.com)"` as the company name in EMR automatically.
- **Google OAuth expiry:** GBP tokens expire and may need reconnection. Customer reconnects in Settings → Integrations.
