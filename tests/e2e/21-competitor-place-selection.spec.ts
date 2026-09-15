import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('selected Google businesses replace form details and handle missing websites', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture and simulated provider only');
  let selected = 'first';
  await page.route('**/api/competitors/search?*', route => route.fulfill({ json: { success: true, data: { results: [{ placeId: selected, name: selected === 'first' ? 'First Fitness' : 'Second Fitness', address: 'Tulsa', rating: 4.5, reviewCount: 3 }] } } }));
  await page.route('**/api/competitors/place-details?*', route => route.fulfill({ json: { success: true, data: { name: selected === 'first' ? 'First Fitness LLC' : 'Second Fitness', website: selected === 'first' ? 'https://first.example/' : null } } }));
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
  await page.goto('/dashboard/competitors');
  await page.getByRole('button', { name: 'Add competitor', exact: true }).click();
  const search = page.getByPlaceholder('Search by business name…');
  await search.fill('First'); await search.press('Enter');
  await page.getByRole('button', { name: /First Fitness Tulsa/ }).click();
  await expect(page.getByPlaceholder('Acme Plumbing Co.')).toHaveValue('First Fitness LLC');
  await expect(page.getByPlaceholder('https://acmeplumbing.com')).toHaveValue('https://first.example/');
  selected = 'second';
  await search.fill('Second'); await search.press('Enter');
  await page.getByRole('button', { name: /Second Fitness Tulsa/ }).click();
  await expect(page.getByPlaceholder('Acme Plumbing Co.')).toHaveValue('Second Fitness');
  await expect(page.getByPlaceholder('https://acmeplumbing.com')).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('Google has no website listed');
  await expect(page.getByPlaceholder('ChIJ… (auto-filled when you pick from search)')).toHaveValue('second');
  await page.route('**/api/competitors/place-details?*', route => route.fulfill({ status: 502, json: { success: false } }));
  selected = 'first'; await search.fill('First'); await search.press('Enter');
  await page.getByRole('button', { name: /First Fitness Tulsa/ }).click();
  await expect(page.getByRole('status')).toContainText('Website lookup failed');
  await expect(page.getByPlaceholder('Acme Plumbing Co.')).toHaveValue('First Fitness');
  await expect(page.getByPlaceholder('https://acmeplumbing.com')).toBeEnabled();
  let submitted: { website?: string } | undefined;
  await page.route('**/api/competitors', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { success: true, data: {} } });
  });
  await page.getByPlaceholder('https://acmeplumbing.com').fill('www.first.example');
  await page.getByRole('button', { name: 'Add competitor', exact: true }).last().click();
  await expect(page.getByPlaceholder('Acme Plumbing Co.')).toHaveCount(0);
  expect(submitted?.website).toBe('www.first.example');
});
