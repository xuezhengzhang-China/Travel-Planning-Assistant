/**
 * 行程的用户附加状态（与当天安排无关的那部分）：
 * - visited / footprints：行程里勾选的“去过”，以及它对应的足迹记录 id；
 * - bookings：每个景点的预约状态；
 * - stay / packing：住宿信息与行李清单；
 * - reminders：出发提醒设置与完成情况。
 *
 * 这些数据原来只存在浏览器 localStorage，换设备就丢；集中放进一张 jsonb 表，
 * 语义仍然由前端定义，但归属跟着用户走。
 */
exports.up = (pgm) => {
  pgm.createTable('trip_state', {
    trip_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'trips',
      onDelete: 'CASCADE',
    },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    state: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.addConstraint('trip_state', 'trip_state_state_object_check', {
    check: `jsonb_typeof(state) = 'object'`,
  });
  pgm.createIndex('trip_state', 'owner_id');
};

exports.down = (pgm) => {
  pgm.dropTable('trip_state');
};
