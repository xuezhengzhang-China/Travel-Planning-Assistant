/**
 * places 统一到 B：行程的城市与景点校验改读 B 的 destinations / places 表。
 * C 早期为行程单独维护的 c_destinations / c_places 已无调用方，这里删除它们
 * 以及 trip 表上指向 c_destinations 的外键；trip_selections / trip_days / trip_items
 * 本身保留，行程数据与版本控制不受影响。
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_city_fk;
    ALTER TABLE trip_selections DROP CONSTRAINT IF EXISTS trip_selections_place_id_city_id_fkey;
    DROP TABLE IF EXISTS c_places;
    DROP TABLE IF EXISTS c_destinations;
  `);
};

exports.down = false;
