/**
 * k6 load test — 50 concurrent users, target p95 < 2s
 *
 * Run:
 *   k6 run --vus 50 --duration 60s tests/k6/load-test.js
 *
 * Install k6: https://k6.io/docs/get-started/installation/
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95th percentile under 2s
    http_req_failed: ['rate<0.01'],     // error rate under 1%
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

// Pre-test: obtain a JWT token for authenticated requests
export function setup() {
  const loginRes = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: __ENV.TEST_EMAIL, password: __ENV.TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} — set TEST_EMAIL and TEST_PASSWORD env vars`);
  }
  return { token: loginRes.json('data.accessToken') };
}

export default function ({ token }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // --- Public / health ---
  const health = http.get(`${BASE}/api/health/live`);
  check(health, { 'health 200': (r) => r.status === 200 });

  // --- Rankings ---
  const rankings = http.get(`${BASE}/api/rankings`, { headers });
  check(rankings, { 'rankings 200': (r) => r.status === 200 });

  // --- Reviews ---
  const reviews = http.get(`${BASE}/api/reviews?page=1&limit=20`, { headers });
  check(reviews, { 'reviews 200': (r) => r.status === 200 });

  // --- Analytics ---
  const analytics = http.get(`${BASE}/api/analytics/reviews/trend?days=30`, { headers });
  check(analytics, { 'analytics 200': (r) => r.status === 200 });

  // --- Dashboard metrics ---
  const metrics = http.get(`${BASE}/api/metrics/dashboard`, { headers });
  check(metrics, { 'metrics 200': (r) => r.status === 200 });

  sleep(1);
}
