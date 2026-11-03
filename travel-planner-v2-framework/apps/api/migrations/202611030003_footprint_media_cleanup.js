exports.up = (pgm) => {
  pgm.createTable('footprint_media_cleanup', {
    storage_key: { type: 'varchar(80)', primaryKey: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('footprint_media_cleanup');
};
