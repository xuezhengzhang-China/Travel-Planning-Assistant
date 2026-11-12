exports.up = (pgm) => {
  pgm.addColumns('trips', {
    city_id: { type: 'uuid' }, // 旧行程保持 NULL，不伪造城市；v2 查询仅包含有城市的记录。
    revision: { type: 'integer', notNull: true, default: 1, check: 'revision > 0' },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'draft',
      check: "status IN ('draft', 'planned')",
    },
    themes: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
      check: "jsonb_typeof(themes) = 'array'",
    },
    pace: {
      type: 'varchar(20)',
      notNull: true,
      default: 'standard',
      check: "pace IN ('relaxed', 'standard', 'intensive')",
    },
    transport_mode: {
      type: 'varchar(20)',
      notNull: true,
      default: 'walking',
      check: "transport_mode IN ('walking', 'transit', 'driving')",
    },
    selected_place_ids: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
      check: "jsonb_typeof(selected_place_ids) = 'array'",
    },
    days: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
      check: "jsonb_typeof(days) = 'array'",
    },
  });
  pgm.createIndex('trips', ['owner_id', 'updated_at', 'id'], {
    name: 'trips_owner_updated_id_idx',
  });
};
exports.down = (pgm) => {
  pgm.dropIndex('trips', ['owner_id', 'updated_at', 'id'], { name: 'trips_owner_updated_id_idx' });
  pgm.dropColumns('trips', [
    'city_id',
    'revision',
    'status',
    'themes',
    'pace',
    'transport_mode',
    'selected_place_ids',
    'days',
  ]);
};
