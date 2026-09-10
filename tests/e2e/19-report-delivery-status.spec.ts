import {test,expect} from '@playwright/test';
import {loginViaUI} from './helpers/auth';
import {dbQuery,dbScalar} from './helpers/db';
import {IS_PRODUCTION_TARGET} from './config';
test('report status distinguishes available PDF from unconfirmed email and exposes recovery guidance',async({page})=>{
  test.skip(IS_PRODUCTION_TARGET,'Disposable fixture; no generation or mail');
  const client=dbScalar("SELECT c.id FROM clients c JOIN users u ON u.id=c.user_id WHERE u.email='pro@fixture.test'");
  const id=dbScalar(`INSERT INTO reports(client_id,period_month,period_year,status,file_path,email_status,generated_at) VALUES('${client}',1,2020,'generated','/fixture/no-send.pdf','uncertain',now()) RETURNING id`);
  try{
    await loginViaUI(page,'pro@fixture.test','TestPass123!');await page.goto('/dashboard/reports');
    const row=page.getByRole('row').filter({has:page.getByText('January 2020',{exact:true})});
    await expect(row.getByText('Email outcome unknown — do not resend',{exact:true})).toBeVisible();
    await expect(row.getByRole('button',{name:'Download',exact:true})).toBeVisible();
    await page.getByText('Report status and recovery',{exact:true}).click();
    await expect(page.getByText(/accepted, unresolved and historical email attempts are not resent/)).toBeVisible();
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/report-delivery-mobile.png',fullPage:true});
  }finally{dbQuery(`DELETE FROM reports WHERE id='${id}'`);}
});
