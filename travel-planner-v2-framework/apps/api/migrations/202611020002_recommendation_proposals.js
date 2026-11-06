exports.up = (pgm) => {
  pgm.createTable('recommendation_proposals', {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    input_snapshot: { type: 'jsonb', notNull: true },
    proposal: { type: 'jsonb', notNull: true },
    generated_at: { type: 'timestamptz', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('recommendation_proposals', 'proposal_expiry', {
    check: 'expires_at > generated_at',
  });
  pgm.createIndex('recommendation_proposals', ['owner_id', 'id']);
  pgm.createIndex('recommendation_proposals', 'expires_at');
};
exports.down = (pgm) => pgm.dropTable('recommendation_proposals');
