exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(320)', notNull: true, unique: true },
    display_name: { type: 'varchar(80)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createTable('trips', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    title: { type: 'varchar(120)', notNull: true },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('trips', 'owner_id');

  pgm.createTable('trip_members', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    trip_id: { type: 'uuid', notNull: true, references: 'trips(id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    role: { type: 'varchar(20)', notNull: true, default: 'editor' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.addConstraint('trip_members', 'trip_members_trip_user_unique', {
    unique: ['trip_id', 'user_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('trip_members');
  pgm.dropTable('trips');
  pgm.dropTable('users');
};
