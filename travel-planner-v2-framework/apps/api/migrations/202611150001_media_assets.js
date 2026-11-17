/**
 * 手账图片：媒体实体单独建表，随笔通过 journal_media 关联。
 * 一个媒体最多关联一篇随笔；删除随笔只删关联，媒体保留为未引用。
 */
exports.up = (pgm) => {
  pgm.createTable('media_assets', {
    id: { type: 'uuid', primaryKey: true },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    storage_key: { type: 'varchar(80)', notNull: true, unique: true },
    mime_type: { type: 'varchar(40)', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    original_name: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('media_assets', 'owner_id');

  pgm.createTable('journal_media', {
    journal_id: {
      type: 'uuid',
      notNull: true,
      references: 'journal_entries(id)',
      onDelete: 'CASCADE',
    },
    media_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'media_assets(id)',
      onDelete: 'RESTRICT',
    },
    position: { type: 'integer', notNull: true, check: 'position >= 0' },
  });
  pgm.addConstraint('journal_media', 'journal_media_pkey', {
    primaryKey: ['journal_id', 'position'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('journal_media');
  pgm.dropTable('media_assets');
};
