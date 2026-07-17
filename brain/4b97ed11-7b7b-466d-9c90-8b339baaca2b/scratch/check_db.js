const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:Noxiath@8888@db.qjwezphwqrcbbuetblsg.supabase.co:6543/postgres', // using port 6543 (pooler)
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT * FROM ticket_analyses ORDER BY created_at DESC LIMIT 5');
  console.log('--- Ticket Analyses ---');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

run().catch(console.error);
