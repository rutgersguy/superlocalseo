/**
 * Cypress E2E — critical user paths
 * Run: npx cypress run --spec "tests/cypress/e2e/critical-paths.cy.ts"
 *
 * Requires: cypress.config.ts at repo root with baseUrl set.
 * Install: npm install --save-dev cypress (from repo root or frontend/)
 */

const TEST_EMAIL = Cypress.env('TEST_EMAIL') || 'e2e@example.com';
const TEST_PASSWORD = Cypress.env('TEST_PASSWORD') || 'Password123!';
const TEST_BUSINESS = 'E2E Test Business';

describe('Authentication', () => {
  it('registers a new account', () => {
    cy.visit('/register');
    cy.get('input[name="email"]').type(TEST_EMAIL);
    cy.get('input[name="password"]').type(TEST_PASSWORD);
    cy.get('input[name="businessName"]').type(TEST_BUSINESS);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/registered');
  });

  it('logs in with valid credentials', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(TEST_EMAIL);
    cy.get('input[name="password"]').type(TEST_PASSWORD);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');
  });

  it('shows error on invalid credentials', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type('nobody@example.com');
    cy.get('input[name="password"]').type('wrongpass');
    cy.get('button[type="submit"]').click();
    cy.contains(/invalid|incorrect/i).should('be.visible');
  });
});

describe('Dashboard', () => {
  beforeEach(() => {
    // Fast login via API to avoid re-testing auth flow
    cy.request('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD })
      .then((res) => {
        window.localStorage.setItem('accessToken', res.body.data.accessToken);
      });
    cy.visit('/dashboard');
  });

  it('shows metric cards', () => {
    cy.contains(/ranking|review|citation/i).should('be.visible');
  });

  it('navigates to rankings page', () => {
    cy.get('a[href*="rankings"]').click();
    cy.url().should('include', '/rankings');
  });

  it('navigates to reviews page', () => {
    cy.get('a[href*="reviews"]').click();
    cy.url().should('include', '/reviews');
  });
});

describe('Reports', () => {
  beforeEach(() => {
    cy.request('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD })
      .then((res) => { window.localStorage.setItem('accessToken', res.body.data.accessToken); });
    cy.visit('/dashboard/reports');
  });

  it('shows reports page without error', () => {
    cy.contains(/report/i).should('be.visible');
  });

  it('manual generate button exists', () => {
    cy.contains(/generate/i).should('be.visible');
  });
});

describe('Settings', () => {
  beforeEach(() => {
    cy.request('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD })
      .then((res) => { window.localStorage.setItem('accessToken', res.body.data.accessToken); });
    cy.visit('/dashboard/settings');
  });

  it('shows account tab by default', () => {
    cy.contains(/account/i).should('be.visible');
    cy.contains(/integrations/i).should('be.visible');
  });

  it('can switch to QR codes tab', () => {
    cy.contains('QR Codes').click();
    cy.contains(/QR code|review/i).should('be.visible');
  });
});
