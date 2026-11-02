const { readdir } = require('node:fs/promises');
const { resolve, parse } = require('node:path');
const { Client } = require('pg');
const { config } = require('dotenv');

async function getMigrationStatus(client, directory) {
  const files = (await readdir(directory))
    .filter((name) => /\.(js|cjs|ts|sql)$/.test(name))
    .map((name) => parse(name).name)
    .sort();
  const table = await client.query('SELECT to_regclass($1) AS relation', ['public.pgmigrations']);
  const applied = table.rows[0].relation
    ? (await client.query('SELECT name FROM public.pgmigrations ORDER BY id')).rows.map(
        (row) => row.name,
      )
    : [];
  const local = new Set(files);
  const executed = new Set(applied);
  return [
    ...files.map((name) => ({ name, status: executed.has(name) ? 'applied' : 'pending' })),
    ...applied.filter((name) => !local.has(name)).map((name) => ({ name, status: 'missing-file' })),
  ];
}

async function main() {
  config({ path: resolve(__dirname, '../../../.env') });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  try {
    await client.connect();
    console.table(await getMigrationStatus(client, resolve(__dirname, '../migrations')));
  } finally {
    await client.end();
  }
}

module.exports = { getMigrationStatus };

if (require.main === module) {
  main().catch(() => {
    console.error(
      'Migration status unavailable. Check DATABASE_URL and that PostgreSQL is running.',
    );
    process.exitCode = 1;
  });
}
