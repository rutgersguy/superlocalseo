/**
 * EMR reconciliation — finds orphaned EmbedMyReviews sub-accounts.
 *
 * An orphan is an EMR customer with no corresponding `clients.emr_customer_id` in our DB.
 * They accumulated for two reasons:
 *   1. `deprovisionClient` / `deleteClientEMR` were never called from anywhere, so cancelling
 *      or deleting a client left its EMR account live.
 *   2. `suspendCustomer` called a non-existent endpoint (POST /suspend instead of PUT /pause)
 *      and swallowed the failure, so even the intended pause silently no-op'd.
 * Both are fixed, but the accounts already stranded in EMR need a one-off sweep.
 *
 * DRY RUN BY DEFAULT — prints what it would do and changes nothing.
 *
 *   npm run emr:reconcile                 # dry run — list orphans + dangling clients
 *   npm run emr:reconcile -- --delete     # delete orphaned EMR accounts (destructive)
 *   npm run emr:reconcile -- --reprovision # rebuild EMR accounts for dangling clients
 *
 * Deletion is PERMANENT on EMR's side ("Permanently delete a customer account"), so the
 * --delete flag is deliberately not the default.
 *
 * --reprovision handles the mirror-image problem: a client whose EMR account was deleted
 * (e.g. by hand) still has emr_provisioning_status='provisioned', and provisionClient()
 * early-returns on that — so it can NEVER heal itself, and its review sync silently pulls
 * from an account that no longer exists. This resets the status and rebuilds the account.
 */
import { db } from '../db/connection';
import { listAllCustomers, deleteCustomer } from '../services/embedmyreviews.service';
import { provisionClient } from '../services/emr_provisioning';

async function main(): Promise<void> {
  const doDelete = process.argv.includes('--delete');
  const doReprovision = process.argv.includes('--reprovision');
  const mode = doDelete ? 'DELETE MODE (destructive)'
    : doReprovision ? 'REPROVISION MODE'
    : 'DRY RUN';

  console.log(`EMR reconcile — ${mode}\n`);

  const emrCustomers = await listAllCustomers();

  const clients = await db('clients')
    .whereNotNull('emr_customer_id')
    .select('id', 'business_name', 'emr_customer_id') as Array<{
      id: string; business_name: string; emr_customer_id: string;
    }>;

  const knownIds = new Set(clients.map((c) => String(c.emr_customer_id)));
  const orphans = emrCustomers.filter((c) => !knownIds.has(String(c.id)));

  // The mirror image: a client pointing at an EMR account that no longer exists. Not
  // destructive to leave, but it means review sync is silently pulling nothing for them.
  const emrIds = new Set(emrCustomers.map((c) => String(c.id)));
  const danglingClients = clients.filter((c) => !emrIds.has(String(c.emr_customer_id)));

  console.log(`EMR customers:        ${emrCustomers.length}`);
  console.log(`Clients with EMR id:  ${clients.length}`);
  console.log(`Orphans in EMR:       ${orphans.length}`);
  console.log(`Dangling clients:     ${danglingClients.length}\n`);

  if (danglingClients.length > 0) {
    console.log('Clients whose EMR account is GONE (review sync pulls nothing for these):');
    for (const c of danglingClients) {
      console.log(`  client=${c.id}  ${c.business_name}  emr_customer_id=${c.emr_customer_id}`);
    }
    console.log('');

    if (doReprovision) {
      let fixed = 0;
      for (const c of danglingClients) {
        try {
          // provisionClient() early-returns on status 'provisioned', so clear it first —
          // otherwise the rebuild is a no-op and the client stays broken.
          await db('clients').where({ id: c.id }).update({
            emr_customer_id: null,
            emr_password_encrypted: null,
            emr_provisioning_status: 'pending',
            updated_at: new Date(),
          });
          await provisionClient(c.id);

          const after = await db('clients').where({ id: c.id })
            .select('emr_customer_id', 'emr_provisioning_status').first();
          if (after?.emr_customer_id) {
            fixed++;
            console.log(`  reprovisioned ${c.business_name} → emr_customer_id=${after.emr_customer_id}`);
          } else {
            console.error(`  FAILED ${c.business_name}: status=${after?.emr_provisioning_status}`);
          }
        } catch (e) {
          console.error(`  FAILED ${c.business_name}: ${(e as Error).message}`);
        }
      }
      console.log(`\nReprovisioned ${fixed}/${danglingClients.length}.\n`);
    } else {
      console.log(`  → re-run with --reprovision to rebuild these ${danglingClients.length} EMR account(s).\n`);
    }
  }

  if (orphans.length === 0) {
    console.log('No orphaned EMR accounts. Nothing to do.');
    await db.destroy();
    return;
  }

  console.log('Orphaned EMR accounts (no matching client in our DB):');
  for (const o of orphans) {
    console.log(`  id=${o.id}  ${o.company ?? o.name ?? '(no name)'}  <${o.email ?? 'no email'}>`);
  }
  console.log('');

  if (!doDelete) {
    console.log(`DRY RUN — nothing changed. Re-run with --delete to permanently remove these ${orphans.length} account(s).`);
    await db.destroy();
    return;
  }

  let deleted = 0;
  const failed: Array<{ id: string; error: string }> = [];

  for (const o of orphans) {
    try {
      await deleteCustomer(o.id);
      deleted++;
      console.log(`  deleted ${o.id}`);
    } catch (e) {
      failed.push({ id: o.id, error: (e as Error).message });
      console.error(`  FAILED ${o.id}: ${(e as Error).message}`);
    }
  }

  console.log(`\nDeleted ${deleted}/${orphans.length}. Failed: ${failed.length}`);
  await db.destroy();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Reconcile failed:', e);
  process.exit(1);
});
