exports.up = (pgm) => {
  pgm.createTable('footprint_entries', {
    id: { type: 'uuid', primaryKey: true },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    text_content: { type: 'text' },
    longitude: { type: 'double precision', notNull: true },
    latitude: { type: 'double precision', notNull: true },
    coordinate_system: { type: 'varchar(10)', notNull: true },
    recorded_on: { type: 'date', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_coordinate_system_check', {
    check: "coordinate_system IN ('GCJ-02', 'WGS-84')",
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_longitude_check', {
    check: 'longitude BETWEEN -180 AND 180',
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_latitude_check', {
    check: 'latitude BETWEEN -90 AND 90',
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_id_owner_unique', {
    unique: ['id', 'owner_id'],
  });
  pgm.createIndex('footprint_entries', ['owner_id', 'recorded_on']);

  pgm.createTable('footprint_media', {
    id: { type: 'uuid', primaryKey: true },
    entry_id: { type: 'uuid', notNull: true, unique: true },
    owner_id: { type: 'uuid', notNull: true },
    storage_key: { type: 'varchar(80)', notNull: true, unique: true },
    kind: { type: 'varchar(10)', notNull: true },
    original_name: { type: 'varchar(255)', notNull: true },
    mime_type: { type: 'varchar(40)', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.addConstraint('footprint_media', 'footprint_media_entry_owner_fkey', {
    foreignKeys: {
      columns: ['entry_id', 'owner_id'],
      references: 'footprint_entries(id, owner_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('footprint_media', 'footprint_media_kind_check', {
    check: "kind IN ('photo', 'video')",
  });
  pgm.createIndex('footprint_media', 'owner_id');
};

exports.down = (pgm) => {
  pgm.dropTable('footprint_media');
  pgm.dropTable('footprint_entries');
};
