exports.up = (pgm) => {
  pgm.createTable('recommendation_proposals', {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    payload: { type: 'jsonb', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('recommendation_proposals', ['owner_id', 'expires_at']);
};
exports.down = (pgm) => pgm.dropTable('recommendation_proposals');
