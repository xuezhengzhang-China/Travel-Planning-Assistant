const { resolve } = require('node:path');
const { Client } = require('pg');
const { config } = require('dotenv');
const fixture = require('../../../docs/examples/demo-scenario.json');

async function seedB(client) {
  await client.query('BEGIN');
  try {
    for (const d of fixture.destinations) {
      await client.query(
        `INSERT INTO destinations (id,name,level,parent_id,adcode,time_zone)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=excluded.name,
        level=excluded.level,parent_id=excluded.parent_id,adcode=excluded.adcode,time_zone=excluded.time_zone`,
        [d.id, d.name, d.level, d.parentId, d.adcode, d.timeZone],
      );
    }
    for (const p of fixture.places) {
      await client.query(
        `INSERT INTO places
        (id,city_id,name,categories,address,longitude,latitude,coordinate_system,suggested_duration_minutes,description,opening_hours_text,source,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET name=excluded.name,categories=excluded.categories,
        address=excluded.address,longitude=excluded.longitude,latitude=excluded.latitude,
        suggested_duration_minutes=excluded.suggested_duration_minutes,description=excluded.description,
        opening_hours_text=excluded.opening_hours_text,updated_at=excluded.updated_at WHERE places.source='fixture'`,
        [
          p.id,
          p.cityId,
          p.name,
          p.categories,
          p.address,
          p.coordinates.longitude,
          p.coordinates.latitude,
          p.coordinates.coordinateSystem,
          p.suggestedDurationMinutes,
          p.description,
          p.openingHoursText,
          p.source,
          p.updatedAt,
        ],
      );
    }
    await client.query('UPDATE destinations SET amap_citycode=$1 WHERE id=$2', [
      '0571',
      fixture.destinations[1].id,
    ]);
    // Explicit demo district mappings; unknown codes remain unconfirmed, never guessed by prefix.
    for (const adcode of ['330106', '330110']) {
      await client.query(
        `INSERT INTO destination_admin_codes (adcode,city_id) VALUES ($1,$2)
        ON CONFLICT (adcode) DO UPDATE SET city_id=excluded.city_id`,
        [adcode, fixture.destinations[1].id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
async function main() {
  config({ path: resolve(__dirname, '../../../.env') });
  if (process.env.NODE_ENV === 'production' || !process.argv.includes('--development'))
    throw new Error('Use --development in a development environment');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await seedB(client);
    console.log('B demo destinations and places seeded; no user accounts created.');
  } finally {
    await client.end();
  }
}
module.exports = { seedB };
if (require.main === module)
  main().catch(() => {
    console.error('B seed failed. Check the database and migration state.');
    process.exitCode = 1;
  });
