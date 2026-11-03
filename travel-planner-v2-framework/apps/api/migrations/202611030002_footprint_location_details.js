exports.up = (pgm) => {
  pgm.addColumns('footprint_entries', {
    place_name: { type: 'varchar(255)' },
    place_address: { type: 'text' },
    poi_id: { type: 'varchar(80)' },
    map_longitude: { type: 'double precision' },
    map_latitude: { type: 'double precision' },
    province_name: { type: 'varchar(120)' },
    province_adcode: { type: 'varchar(12)' },
    city_name: { type: 'varchar(120)' },
    city_adcode: { type: 'varchar(12)' },
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_map_longitude_check', {
    check: 'map_longitude IS NULL OR map_longitude BETWEEN -180 AND 180',
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_map_latitude_check', {
    check: 'map_latitude IS NULL OR map_latitude BETWEEN -90 AND 90',
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_map_coordinate_pair_check', {
    check: '(map_longitude IS NULL) = (map_latitude IS NULL)',
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_province_pair_check', {
    check: '(province_name IS NULL) = (province_adcode IS NULL)',
  });
  pgm.addConstraint('footprint_entries', 'footprint_entries_city_pair_check', {
    check: '(city_name IS NULL) = (city_adcode IS NULL)',
  });
  pgm.createIndex('footprint_entries', ['owner_id', 'province_adcode', 'city_adcode']);
  pgm.createIndex('footprint_entries', ['owner_id', 'poi_id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('footprint_entries', ['owner_id', 'poi_id']);
  pgm.dropIndex('footprint_entries', ['owner_id', 'province_adcode', 'city_adcode']);
  pgm.dropConstraint('footprint_entries', 'footprint_entries_city_pair_check');
  pgm.dropConstraint('footprint_entries', 'footprint_entries_province_pair_check');
  pgm.dropConstraint('footprint_entries', 'footprint_entries_map_coordinate_pair_check');
  pgm.dropConstraint('footprint_entries', 'footprint_entries_map_latitude_check');
  pgm.dropConstraint('footprint_entries', 'footprint_entries_map_longitude_check');
  pgm.dropColumns('footprint_entries', [
    'place_name',
    'place_address',
    'poi_id',
    'map_longitude',
    'map_latitude',
    'province_name',
    'province_adcode',
    'city_name',
    'city_adcode',
  ]);
};
