import { execSync } from 'child_process';

export function dbQuery(sql: string): string {
  const escaped = sql.replace(/'/g, `'\\''`);
  return execSync(
    `docker exec superlocalseo-postgres psql -U slseo -d superlocalseo -t -c '${escaped}'`
  ).toString().trim();
}

export function cleanupTestUsers(): void {
  dbQuery("DELETE FROM users WHERE email LIKE 'pw-%@test.com'");
}

export function getClientForEmail(email: string): string {
  return dbQuery(`SELECT onboarding_step, business_name FROM clients WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
}
