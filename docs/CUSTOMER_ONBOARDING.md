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
- Click **Next**

### Step 4 — Connect Google Business Profile
- Click **Connect Google** and complete the OAuth flow
- Optional but strongly recommended — enables Google review sync and ranking data
- Click **Finish** (can skip Google and connect later in Settings)

---

## 3. After Clicking Finish (Automatic)

The following happen server-side when the customer clicks Finish:

- EMR review management sub-account is created and credentials are stored
- Citation scan is queued — results appear in the Citations tab within a few minutes
- Customer is redirected to the billing page to select a plan

> **Note:** If EMR provisioning times out (12s limit), `emr_provisioning_status` is set to `failed` and the customer still proceeds. Provisioning can be retried via the retry button or manually from the server.

---

## 4. Set Up Review Management (EMR)

- An amber banner appears on the **Reviews** and **Campaigns** pages
- Customer clicks **"Set Up Review Management"**
- A modal displays their login credentials:
  - **Login URL:** `https://app.superlocalseo.com`
  - **Email:** their registered email address
  - **Password:** auto-generated (copy button provided)
- Customer logs into `app.superlocalseo.com` with those credentials
- Inside EMR, they connect their Google, Yelp, Facebook, and other review profiles
- Reviews sync hourly via the BullMQ job, or near-instantly via webhook for new reviews

---

## 5. Send a Test Review Request (Optional)

- Inside `app.superlocalseo.com`, create a campaign
- Send a review invite to a test contact
- Verify the email flow works end-to-end

---

## Operator Checklist (After Customer Onboards)

- [ ] Confirm `emr_provisioning_status = provisioned` and `emr_customer_id` is populated in the admin panel
- [ ] If EMR credentials modal shows "still being set up", re-provision manually:
  1. Set `emr_provisioning_status = 'failed'` in DB for that client
  2. Run `provisionClient(clientId)` via ts-node in the API container
- [ ] Confirm citation scan results are populating in the Citations tab
- [ ] Confirm billing plan is set (or manually set trial via admin panel)

---

## Pricing Reference

| Locations | Monthly Cost |
|---|---|
| 1 (base) | Plan base price |
| Each additional | +$125/mo |

---

## Known Issues

- **EMR company name collision:** If two customers share the same business name, provisioning retries with `"Business Name (email@domain.com)"` as the company name in EMR automatically.
- **Google OAuth expiry:** GBP tokens expire and may need reconnection. Customer reconnects in Settings → Integrations.
