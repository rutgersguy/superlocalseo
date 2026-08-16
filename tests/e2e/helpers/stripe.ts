import { execSync } from 'child_process';

/**
 * Reads the price that Stripe will ACTUALLY charge, so pricing tests assert
 * rendered copy against the billing system rather than against another hardcoded
 * literal in the test file.
 *
 * This matters because pricing copy is the single most-repeated defect in this
 * project — seven incidents (#110, #111, #113, #116, #120, #125, #141/#142), two
 * of which showed a user one price and charged another (#113 quoted Pro's $349 +
 * $499 setup to someone checking out on Lite; #125 quoted a waived fee to trialing
 * users). PRICING.md keeps a "where pricing is displayed — keep these in sync"
 * table precisely because there is no shared source of truth in the code.
 *
 * A test that hardcodes $149 only proves the test and the UI agree with each
 * other. Reading Stripe closes the loop.
 */

function containerEnv(name: string): string | null {
  try {
    const value = execSync(`docker exec superlocalseo-api printenv ${name}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return value || null;
  } catch {
    return null; // printenv exits non-zero when the var is unset
  }
}

export interface StripePrice {
  id: string;
  /** Amount in whole dollars. */
  dollars: number;
  recurring: boolean;
}

export async function fetchStripePrice(priceId: string, secretKey: string): Promise<StripePrice> {
  const res = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    throw new Error(`Stripe price ${priceId} → HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    id: string;
    unit_amount: number | null;
    recurring: unknown | null;
  };
  if (body.unit_amount == null) throw new Error(`Stripe price ${priceId} has no unit_amount`);
  return {
    id: body.id,
    dollars: body.unit_amount / 100,
    recurring: body.recurring != null,
  };
}

export interface PriceBook {
  lite: number;
  pro: number;
  extraLocation: number;
  setupFee: number;
}

/**
 * Returns the live price book, or null when Stripe credentials are unavailable
 * (so the suite degrades to internal-consistency checks rather than failing for
 * an environment reason).
 */
export async function loadPriceBook(): Promise<PriceBook | null> {
  const secretKey = containerEnv('STRIPE_SECRET_KEY');
  const ids = {
    lite: containerEnv('STRIPE_LITE_BASE_PRICE_ID'),
    pro: containerEnv('STRIPE_BASE_PRICE_ID'),
    extraLocation: containerEnv('STRIPE_LOCATION_PRICE_ID'),
    setupFee: containerEnv('STRIPE_SETUP_PRICE_ID'),
  };

  if (!secretKey || Object.values(ids).some((v) => !v)) return null;

  const [lite, pro, extraLocation, setupFee] = await Promise.all([
    fetchStripePrice(ids.lite!, secretKey),
    fetchStripePrice(ids.pro!, secretKey),
    fetchStripePrice(ids.extraLocation!, secretKey),
    fetchStripePrice(ids.setupFee!, secretKey),
  ]);

  return {
    lite: lite.dollars,
    pro: pro.dollars,
    extraLocation: extraLocation.dollars,
    setupFee: setupFee.dollars,
  };
}

/** True when the setup fee is switched off, i.e. it must never be shown as payable. */
export function setupFeeEnabled(): boolean {
  return containerEnv('STRIPE_SETUP_FEE_ENABLED') === 'true';
}
