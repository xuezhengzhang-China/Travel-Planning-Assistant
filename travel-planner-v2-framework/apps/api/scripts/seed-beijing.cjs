const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { Client } = require('pg');
const { config } = require('dotenv');
const catalog = require('../../../packages/shared/data/beijing.json');
const data = require('./data/beijing-places.json');

async function seedBeijing(client) {
  assert.equal(data.places.length, catalog.places.length);
  const coordinates = new Map(data.places.map((place) => [place.id, place]));
  await client.query('BEGIN');
  try {
    for (const destination of data.destinations) {
      const inserted = await client.query(
        `INSERT INTO destinations (id,name,level,parent_id,adcode,amap_citycode,time_zone)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
         name=excluded.name,amap_citycode=excluded.amap_citycode,time_zone=excluded.time_zone
         WHERE destinations.adcode=excluded.adcode AND destinations.level=excluded.level
         RETURNING id`,
        [
          destination.id,
          destination.name,
          destination.level,
          destination.parentId,
          destination.adcode,
          destination.amapCitycode,
          destination.timeZone,
        ],
      );
      assert.equal(inserted.rowCount, 1, `Conflicting destination for ${destination.name}`);
    }
    for (const place of catalog.places) {
      const point = coordinates.get(place.id);
      assert.ok(point && point.name === place.name);
      assert.equal(point.coordinateSystem, 'GCJ-02');
      const info = place.visitInfo;
      const inserted = await client.query(
        `INSERT INTO places
         (id,city_id,name,categories,address,longitude,latitude,coordinate_system,
          suggested_duration_minutes,description,opening_hours_text,source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'curated')
         ON CONFLICT (id) DO UPDATE SET
         categories=excluded.categories,address=excluded.address,longitude=excluded.longitude,
         latitude=excluded.latitude,suggested_duration_minutes=excluded.suggested_duration_minutes,
         description=excluded.description,opening_hours_text=excluded.opening_hours_text,
         updated_at=NOW()
         WHERE places.source='curated' AND places.city_id=excluded.city_id AND places.name=excluded.name
         RETURNING id`,
        [
          place.id,
          place.cityId,
          place.name,
          place.categories,
          place.address,
          point.longitude,
          point.latitude,
          point.coordinateSystem,
          place.suggestedDurationMinutes,
          info.overview,
          info.hours.map((row) => `${row.label}：${row.time}`).join('\n'),
        ],
      );
      assert.equal(inserted.rowCount, 1, `Conflicting catalog entry for ${place.name}`);
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
    await seedBeijing(client);
    console.log(`Beijing catalog synced: ${catalog.places.length} attractions.`);
  } finally {
    await client.end();
  }
}

module.exports = { seedBeijing };
if (require.main === module)
  main().catch(() => {
    console.error('Beijing seed failed. Check the database and migration state.');
    process.exitCode = 1;
  });
