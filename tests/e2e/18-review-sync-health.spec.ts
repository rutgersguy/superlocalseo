import {test,expect} from '@playwright/test';
import {loginViaUI} from './helpers/auth';
import {dbQuery,dbScalar} from './helpers/db';
import {IS_PRODUCTION_TARGET} from './config';
test('review inbox keeps failed-source data visible and supports real search and pagination',async({page})=>{
  test.skip(IS_PRODUCTION_TARGET,'Disposable fixtures only');
  const client=dbScalar("SELECT c.id FROM clients c JOIN users u ON u.id=c.user_id WHERE u.email='pro@fixture.test'");
  try {
    dbQuery(`INSERT INTO reviews(client_id,source,platform,external_review_id,author_name,rating,body,review_date,replied) SELECT '${client}','emr','Google','sync-browser-'||n,'Sync fixture '||n,5,'Retained browser review '||n,now()-(n||' days')::interval,n=21 FROM generate_series(1,21) n`);
    await loginViaUI(page,'pro@fixture.test','TestPass123!');
    await page.route('**/api/reviews/sync-status*',r=>r.fulfill({json:{success:true,data:{source:'EmbedMyReviews',locations:[{locationId:'fixture',name:'Fixture business',status:'failed',lastSuccessAt:'2026-09-01T12:00:00Z',sourceCount:21,storedCount:21}]}}}));
    await page.goto('/dashboard/reviews');
    await expect(page.getByText('Fixture business: Import failed; previously saved reviews are retained',{exact:true})).toBeVisible();
    await expect(page.getByText('Retained browser review 1',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Next reviews',exact:true}).click();
    await expect(page.getByText('Retained browser review 21',{exact:true})).toBeVisible();
    await page.getByLabel('Search reviews').fill('Retained browser review 7');
    await expect(page.getByText('Retained browser review 7',{exact:true})).toBeVisible();
    await expect(page.getByText('Retained browser review 21',{exact:true})).toHaveCount(0);
    await page.getByLabel('Search reviews').fill('');await page.getByLabel('Review status').selectOption('Responded');
    await expect(page.getByText('Retained browser review 21',{exact:true})).toBeVisible();
    await expect(page.getByText('Retained browser review 1',{exact:true})).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/review-sync-health-mobile.png',fullPage:true});
  }finally{dbQuery(`DELETE FROM reviews WHERE client_id='${client}' AND external_review_id LIKE 'sync-browser-%'`);}
});
