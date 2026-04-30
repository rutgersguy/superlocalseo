import type { Knex } from 'knex';
import bcrypt from 'bcrypt';

export async function seed(knex: Knex): Promise<void> {
  // Only seed in dev/test
  if (process.env.NODE_ENV === 'production') return;

  await knex('audit_logs').del();
  await knex('metrics_daily').del();
  await knex('reports').del();
  await knex('reviews').del();
  await knex('citation_snapshots').del();
  await knex('ranking_snapshots').del();
  await knex('keywords').del();
  await knex('integrations').del();
  await knex('locations').del();
  await knex('clients').del();
  await knex('users').del();

  const hash = await bcrypt.hash('password123', 12);

  const [admin] = await knex('users').insert({
    email: 'admin@superlocalseo.com',
    password_hash: hash,
    role: 'admin',
    email_verified: true,
  }).returning('*');

  const [user] = await knex('users').insert({
    email: 'demo@example.com',
    password_hash: hash,
    role: 'client',
    email_verified: true,
  }).returning('*');

  const [client] = await knex('clients').insert({
    user_id: user.id,
    business_name: 'Demo Plumbing Co.',
    industry: 'plumbing',
    subscription_tier: 1,
    subscription_status: 'active',
    onboarding_step: 4,
  }).returning('*');

  const [location] = await knex('locations').insert({
    client_id: client.id,
    name: 'Main Office',
    address: '123 Main St',
    city: 'Tulsa',
    state: 'OK',
    zip: '74101',
    phone: '(918) 555-0100',
    website: 'https://demoplumbing.com',
    is_primary: true,
  }).returning('*');

  const keywordIds = await knex('keywords').insert([
    { location_id: location.id, keyword: 'plumber near me' },
    { location_id: location.id, keyword: 'emergency plumber Tulsa' },
    { location_id: location.id, keyword: 'water heater repair Tulsa' },
  ]).returning('id');

  // Seed 30 days of ranking snapshots
  const snapshots = [];
  for (let day = 29; day >= 0; day--) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    for (const { id: kwId } of keywordIds) {
      snapshots.push({
        keyword_id: kwId,
        location_id: location.id,
        rank: Math.floor(Math.random() * 15) + 1,
        search_engine: 'google',
        pulled_at: date,
      });
    }
  }
  await knex('ranking_snapshots').insert(snapshots);

  // Seed some reviews
  await knex('reviews').insert([
    { client_id: client.id, location_id: location.id, platform: 'google', external_review_id: 'g-001', author_name: 'John D.', rating: 5, body: 'Great service, fast response!', sentiment: 'positive', status: 'new', review_date: new Date() },
    { client_id: client.id, location_id: location.id, platform: 'google', external_review_id: 'g-002', author_name: 'Sarah M.', rating: 4, body: 'Good work, would recommend.', sentiment: 'positive', status: 'responded', review_date: new Date() },
    { client_id: client.id, location_id: location.id, platform: 'yelp', external_review_id: 'y-001', author_name: 'Mike R.', rating: 2, body: 'Took too long to arrive.', sentiment: 'negative', status: 'new', review_date: new Date() },
  ]);

  console.log('Dev seed complete. Login: demo@example.com / password123');
}
