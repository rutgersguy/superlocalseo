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
- The wizard collects location details (name, address, city, state, zip, phone)
- **⚠️ This data is not saved to the database yet** — the wizard is a UI preview only
- Click **Next** (location must be added again via Settings → Locations after onboarding)

### Step 3 — Keywords
- The wizard collects target search terms per location
- **⚠️ This data is not saved to the database yet** — keywords must be added via Settings → Keywords after a location exists
- 3–5 keywords per location to start (e.g. "HVAC repair in Dallas")

### Step 4 — Connect Google Business Profile
- Click **Connect Google** and complete the OAuth flow
- Optional but strongly recommended — enables Google review sync and ranking data
- Click **Finish** (can skip Google and connect later in Settings → Integrations)

---

## 3. After Clicking Finish (Automatic)

The following happen server-side when the customer clicks Finish:

- EMR review management sub-account is created and credentials are stored
- Citation scan is queued — results appear in the Citations tab within a few minutes
- Customer is redirected to **Settings → Billing** tab (trial is already running — no payment required)

> **Billing page behaviour:** If the customer navigates to `/billing` during their trial, they see a soft landing ("You're on a free trial — no payment needed yet") with an option to subscribe early. The card form only appears automatically when ≤7 days remain or the trial has expired.

> **If EMR provisioning fails or times out:** The customer still proceeds to the dashboard normally — all other features (rankings, citations, reports) work immediately. The review management section will show a "still being set up" state until provisioning succeeds. See EMR failure handling below.

## 3a. After Onboarding — Add Location & Keywords

**The onboarding wizard does not save location or keyword data to the database.** After finishing onboarding, the customer (or you as operator) must:

1. Go to **Settings → Locations** → click **Add location** → fill in name, address, city, state, zip, phone
2. Go to **Settings → Keywords** → select the location → add 3–5 target keywords

Until a location is saved, no ranking, citation, or review data will be collected.

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

- [ ] **Add location** — go to Settings → Locations as the client and add their primary location (wizard does not save it)
- [ ] **Add keywords** — go to Settings → Keywords, select the location, add 3–5 target keywords
- [ ] Confirm `emr_provisioning_status = provisioned` and `emr_customer_id` is populated in the admin panel
- [ ] If EMR credentials modal shows "still being set up":
  1. Check admin panel — if `emr_provisioning_status = failed`, use the **Retry Provision** button
  2. If retry fails, set `emr_provisioning_status = 'failed'` in DB and run `provisionClient(clientId)` via ts-node in the API container
  3. Customer can use all other dashboard features in the meantime — only review management is affected
- [ ] Confirm citation scan results are populating in the Citations tab
- [ ] Trial is auto-set to 14 days from registration — no manual action needed unless adjusting

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

## Known Issues / Bugs

- **Onboarding wizard does not save locations or keywords:** Steps 2 and 3 of the wizard are UI-only — data is lost if the user navigates away. Locations and keywords must be added via Settings after onboarding. This is a known bug to be fixed.
- **EMR company name collision:** If two customers share the same business name, provisioning retries with `"Business Name (email@domain.com)"` as the company name in EMR automatically.
- **Google OAuth expiry:** GBP tokens expire and may need reconnection. Customer reconnects in Settings → Integrations.
- **deleteClientEMR not called on admin delete:** EMR sub-accounts are orphaned when a client is deleted via the admin panel. Manual cleanup in the EMR agency dashboard is required.
