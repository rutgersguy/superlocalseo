import { test, expect } from '@playwright/test';
import { IS_PRODUCTION_TARGET } from './config';
const id='22222222-2222-4222-8222-222222222222';
const at='2026-09-09T12:00:00.000Z';
const points=Array.from({length:9},(_,i)=>({lat:33.762909+(1-Math.floor(i/3))*0.018,lng:-84.422675+((i%3)-1)*0.0216,status:i===8?'unavailable':'checked',rank:i===0?2:null,resultCount:i===8?0:12,checkedAt:at,collectedAt:at,items:i===0?[{placeId:'fixture',name:'Fixture business',rank:2}]:[]}));
const snapshot={business:{placeId:'fixture',name:'Fixture business',address:null,rating:5,reviewCount:8,collectedAt:at},generatedAt:at,profileCheckedAt:at,keyword:'video production company',center:{label:'Atlanta city, GA',lat:33.762909,lng:-84.422675},points,summary:{checked:8,unavailable:1,found:1,averageWhenFound:2,counts:{top3:1,fourToTen:0,elevenToTwenty:0,notFound:7},percentages:{top3:12.5,fourToTen:0,elevenToTwenty:0,notFound:87.5}},ratingAction:'Maintain the service customers value and keep inviting honest feedback.'};
test.describe('Native report acquisition',()=>{
 test.skip(IS_PRODUCTION_TARGET,'Isolated browser fixtures only');
 test('selects a business and area, records report-only consent, and shows honest coverage',async({page})=>{
  await page.route('**/api/free-reports/search',r=>r.fulfill({json:{success:true,data:{businesses:[snapshot.business],areas:[{id:'1304000',name:'Atlanta city, GA',lat:33.762909,lng:-84.422675}]}}}));
  await page.route('**/api/free-reports',async r=>{expect(r.request().postDataJSON()).toMatchObject({placeId:'fixture',areaId:'1304000',consent:true,email:'owner@example.test'});await r.fulfill({status:202,json:{success:true,data:{id}}});});
  await page.route(`**/api/free-reports/${id}`,r=>r.fulfill({json:{success:true,data:{status:'completed',snapshot,emailStatus:'accepted'}}}));
  await page.goto('/');await page.getByRole('link',{name:'Check my business free'}).click();await expect(page).toHaveURL(/\/audit$/);await page.getByLabel('Business name',{exact:true}).fill('Fixture business');await page.getByLabel('City and state abbreviation').fill('Atlanta, GA');await page.getByRole('button',{name:'Find my business'}).click();
  await page.getByRole('radio').check();await page.getByLabel('City to sample').selectOption('1304000');await page.getByLabel('Search phrase').fill('video production company');await page.getByLabel('Email for your report link').fill('owner@example.test');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create my free report'}).click();
  await expect(page.getByRole('heading',{name:'Fixture business',exact:true})).toBeVisible();await expect(page.getByText('5.0 / 5',{exact:true})).toBeVisible();await expect(page.getByText('1 / 8',{exact:true})).toBeVisible();await expect(page.getByText('7 points · 87.5%',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Point 9: Unavailable',exact:true})).toBeVisible();await expect(page.getByRole('table').getByText('Not found in 12 returned results',{exact:true})).toHaveCount(7);
  await expect(page.getByRole('region',{name:'Map of the nine search points'})).toBeVisible();
  await expect(page.getByText('Center · 5',{exact:true})).toBeVisible();
  await expect(page.locator('.fr-map-point')).toHaveCount(9);
  await page.getByLabel('Marker opacity').fill('70');
  await expect(page.locator('.fr-map .leaflet-overlay-pane path').first()).toHaveAttribute('fill-opacity','0.7');
  await page.getByRole('button',{name:'Point 1: Rank 2 of 12 returned results',exact:true}).click();
  await expect(page.getByText('Inspect returned businesses at point 1')).toBeVisible();
  await page.getByLabel('Marker opacity').fill('45');
  await page.screenshot({path:'test-results/native-report-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/native-report-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.setViewportSize({width:1200,height:900});await page.emulateMedia({media:'print'});await expect(page.getByRole('button',{name:'Print / save PDF'})).toBeHidden();await page.screenshot({path:'test-results/native-report-print.png',fullPage:true});
 });
 test('makes failed generation recoverable without displaying fabricated results',async({page})=>{
  await page.route(`**/api/free-reports/${id}`,r=>r.fulfill({json:{success:true,data:{status:'failed',snapshot:null,error:'We could not verify the selected business and area.'}}}));
  await page.goto(`/free-report/${id}`);await expect(page.getByRole('heading',{name:'Report unavailable'})).toBeVisible();await expect(page.getByRole('link',{name:'Start a new report'})).toHaveAttribute('href','/audit');await expect(page.getByRole('region',{name:'Report measurements'})).toHaveCount(0);
 });
});
