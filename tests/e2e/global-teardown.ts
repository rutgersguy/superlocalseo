import { cleanupTestUsers } from './helpers/db';

async function globalTeardown() {
  cleanupTestUsers();
}

export default globalTeardown;
