/**
 * 随笔（手账）表：一条到访记录可以有多篇随笔。
 * 通过 (footprint_id, owner_id) 复合外键跟随到访记录删除，删除随笔本身不影响足迹。
 */
exports.up = (pgm) => {
  pgm.createTable('journal_entries', {
    id: { type: 'uuid', primaryKey: true },
    footprint_id: { type: 'uuid', notNull: true },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    title: { type: 'varchar(120)' },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.addConstraint('journal_entries', 'journal_entries_footprint_owner_fkey', {
    foreignKeys: {
      columns: ['footprint_id', 'owner_id'],
      references: 'footprint_entries(id, owner_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('journal_entries', 'journal_entries_body_check', {
    check: 'length(btrim(body)) > 0',
  });
  pgm.createIndex('journal_entries', ['owner_id', 'created_at']);
  pgm.createIndex('journal_entries', ['footprint_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('journal_entries');
};
