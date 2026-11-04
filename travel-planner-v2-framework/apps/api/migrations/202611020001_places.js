exports.up = (pgm) => {
  pgm.createTable('destinations', {
    id: { type: 'uuid', primaryKey: true },
    name: { type: 'text', notNull: true },
    level: { type: 'text', notNull: true, check: "level IN ('province', 'city')" },
    parent_id: { type: 'uuid', references: 'destinations(id)' },
    adcode: { type: 'varchar(6)', notNull: true, unique: true },
    amap_citycode: { type: 'varchar(4)' },
    time_zone: { type: 'text', notNull: true, default: 'Asia/Shanghai' },
  });
  pgm.addConstraint('destinations', 'destination_hierarchy', {
    check:
      "(level = 'province' AND parent_id IS NULL) OR (level = 'city' AND parent_id IS NOT NULL)",
  });
  pgm.createTable('places', {
    id: { type: 'uuid', primaryKey: true },
    city_id: { type: 'uuid', notNull: true, references: 'destinations(id)' },
    name: { type: 'text', notNull: true },
    categories: { type: 'text[]', notNull: true },
    address: { type: 'text', notNull: true },
    longitude: { type: 'double precision', notNull: true, check: 'longitude BETWEEN -180 AND 180' },
    latitude: { type: 'double precision', notNull: true, check: 'latitude BETWEEN -90 AND 90' },
    coordinate_system: {
      type: 'text',
      notNull: true,
      default: 'GCJ-02',
      check: "coordinate_system = 'GCJ-02'",
    },
    suggested_duration_minutes: {
      type: 'integer',
      notNull: true,
      check: 'suggested_duration_minutes > 0',
    },
    description: { type: 'text', notNull: true },
    opening_hours_text: { type: 'text' },
    source: { type: 'text', notNull: true, check: "source IN ('fixture', 'curated', 'provider')" },
    provider: { type: 'text' },
    external_id: { type: 'text' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('places', 'city_id');
  pgm.addConstraint('places', 'places_external_unique', { unique: ['provider', 'external_id'] });
  pgm.createTable('destination_admin_codes', {
    adcode: { type: 'varchar(6)', primaryKey: true },
    city_id: { type: 'uuid', notNull: true, references: 'destinations(id)' },
  });
};
exports.down = (pgm) => {
  pgm.dropTable('destination_admin_codes');
  pgm.dropTable('places');
  pgm.dropTable('destinations');
};
