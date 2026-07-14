import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000')),
  appUrl: optional('APP_URL', 'http://localhost:5173'),
  publicUrl: optional('PUBLIC_URL', 'http://localhost:5173'),
  isProd: optional('NODE_ENV') === 'production',

  db: {
    url: required('DATABASE_URL'),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
  },

  encryption: {
    key: required('ENCRYPTION_KEY'),
  },

  stripe: {
    secretKey: required('STRIPE_SECRET_KEY'),
    publishableKey: required('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
    prices: {
      setup: optional('STRIPE_SETUP_PRICE_ID'),
      base: optional('STRIPE_BASE_PRICE_ID'),
      location: optional('STRIPE_LOCATION_PRICE_ID'),
      liteBase: optional('STRIPE_LITE_BASE_PRICE_ID'), // $149/mo recurring, no setup fee
    },
    // The $499 setup fee is WAIVED by default — the price object is kept in Stripe as
    // a pricing anchor but never charged on new subscriptions. Set STRIPE_SETUP_FEE_ENABLED=true
    // to reintroduce it.
    setupFeeEnabled: optional('STRIPE_SETUP_FEE_ENABLED') === 'true',
  },

  resend: {
    apiKey: required('RESEND_API_KEY'),
    fromEmail: optional('RESEND_FROM_EMAIL', 'noreply@superlocalseo.com'),
    fromName: optional('RESEND_FROM_NAME', 'SuperLocalSEO'),
  },

  brightlocal: {
    apiKey: optional('BRIGHTLOCAL_API_KEY'),
  },

  dataforseo: {
    login: optional('DATAFORSEO_LOGIN'),
    password: optional('DATAFORSEO_PASSWORD'),
  },

  embedmyreviews: {
    apiKey: optional('EMBEDMYREVIEWS_API_KEY'),
    agencyKey: optional('EMBEDMYREVIEWS_AGENCY_KEY'),
    webhookSecret: optional('EMBEDMYREVIEWS_WEBHOOK_SECRET'),
    // Shared secret carried in the webhook URL (?token=) or an X-Webhook-Token header.
    // EMR exposes no signing secret, so this is the supported way to authenticate the
    // inbound webhook — register the URL in EMR with this token appended.
    webhookToken: optional('EMBEDMYREVIEWS_WEBHOOK_TOKEN'),
    baseUrl: optional('EMBEDMYREVIEWS_BASE_URL', 'https://app.superlocalseo.com'),
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
  },

  googlePlacesApiKey: optional('GOOGLE_PLACES_API_KEY'),

  facebook: {
    appId: optional('FACEBOOK_APP_ID'),
    appSecret: optional('FACEBOOK_APP_SECRET'),
  },

  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY'),
  },

  sentry: {
    dsn: optional('SENTRY_DSN'),
  },

  reports: {
    dir: optional('REPORTS_DIR', '/tmp/reports'),
  },
} as const;
