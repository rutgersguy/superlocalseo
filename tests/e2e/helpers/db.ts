import { execSync } from 'child_process';
import { DB_CONTAINER, DB_NAME } from '../config';

// Container and database are derived from E2E_BASE_URL (see config.ts) so the
// browser and these helpers can never end up pointed at different stacks.
export function dbQuery(sql: string): string {
  const escaped = sql.replace(/'/g, `'\\''`);
  return execSync(
    `docker exec ${DB_CONTAINER} psql -U slseo -d ${DB_NAME} -t -c '${escaped}'`
  ).toString().trim();
}

export function cleanupTestUsers(): void {
  dbQuery("DELETE FROM users WHERE email LIKE 'pw-%@test.com'");
}

export function getClientForEmail(email: string): string {
  return dbQuery(`SELECT onboarding_step, business_name FROM clients WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
}
