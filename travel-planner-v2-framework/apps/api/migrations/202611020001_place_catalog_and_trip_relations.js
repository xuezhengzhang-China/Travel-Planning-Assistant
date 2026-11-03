// 固定快照，后续修改景点目录不得改变历史迁移内容。
const catalog = require('./data/beijing-20261102.json');
const literal = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE destinations (
      id uuid PRIMARY KEY, name text NOT NULL, adcode text NOT NULL UNIQUE,
      level text NOT NULL CHECK (level IN ('province','city')), parent_id uuid REFERENCES destinations(id)
    );
    CREATE TABLE places (
      id uuid PRIMARY KEY, city_id uuid NOT NULL REFERENCES destinations(id),
      data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
      UNIQUE(id,city_id)
    );
    CREATE INDEX places_city_idx ON places(city_id);
    INSERT INTO destinations(id,name,adcode,level)
      SELECT (c->>'id')::uuid,c->>'name',c->>'adcode','city' FROM (SELECT ${literal(catalog.city)} AS c) seed;
    INSERT INTO places(id,city_id,data)
      SELECT (p->>'id')::uuid,(p->>'cityId')::uuid,p FROM jsonb_array_elements(${literal(catalog.places)}) p;
    ALTER TABLE trips ADD CONSTRAINT trips_city_fk FOREIGN KEY(city_id) REFERENCES destinations(id);
    ALTER TABLE trips ADD CONSTRAINT trips_id_city_unique UNIQUE(id,city_id);
    CREATE TABLE trip_selections (
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      city_id uuid NOT NULL, place_id uuid NOT NULL, position integer NOT NULL CHECK(position>=0),
      PRIMARY KEY(trip_id,place_id), UNIQUE(trip_id,position),
      FOREIGN KEY(place_id,city_id) REFERENCES places(id,city_id),
      FOREIGN KEY(trip_id,city_id) REFERENCES trips(id,city_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE trip_days (
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE, date date NOT NULL,
      PRIMARY KEY(trip_id,date)
    );
    CREATE TABLE trip_items (
      trip_id uuid NOT NULL, date date NOT NULL, place_id uuid NOT NULL,
      position integer NOT NULL CHECK(position>=0),
      start_time text NOT NULL CHECK(start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      duration_minutes integer NOT NULL CHECK(duration_minutes>0),
      travel_minutes_from_previous integer NOT NULL CHECK(travel_minutes_from_previous>=0),
      travel_time_source text NOT NULL CHECK(travel_time_source IN ('none','provider','estimate')),
      reason text NOT NULL CHECK(length(reason)<=500),
      PRIMARY KEY(trip_id,place_id), UNIQUE(trip_id,date,position),
      FOREIGN KEY(trip_id,date) REFERENCES trip_days(trip_id,date) ON DELETE CASCADE,
      FOREIGN KEY(trip_id,place_id) REFERENCES trip_selections(trip_id,place_id) ON DELETE CASCADE
    );
    INSERT INTO trip_selections(trip_id,city_id,place_id,position)
      SELECT t.id,t.city_id,p.value::uuid,p.ordinality-1 FROM trips t,
        jsonb_array_elements_text(t.selected_place_ids) WITH ORDINALITY p WHERE t.city_id IS NOT NULL;
    INSERT INTO trip_days(trip_id,date)
      SELECT t.id,(d->>'date')::date FROM trips t,jsonb_array_elements(t.days) d WHERE t.city_id IS NOT NULL;
    INSERT INTO trip_items(trip_id,date,place_id,position,start_time,duration_minutes,travel_minutes_from_previous,travel_time_source,reason)
      SELECT t.id,(d->>'date')::date,(i->>'placeId')::uuid,(i->>'position')::integer,i->>'startTime',
        (i->>'durationMinutes')::integer,(i->>'travelMinutesFromPrevious')::integer,i->>'travelTimeSource',i->>'reason'
      FROM trips t,jsonb_array_elements(t.days) d,jsonb_array_elements(d->'items') i WHERE t.city_id IS NOT NULL;
    ALTER TABLE trips DROP COLUMN selected_place_ids, DROP COLUMN days;
    CREATE VIEW trip_resources AS SELECT t.*,
      COALESCE((SELECT jsonb_agg(s.place_id ORDER BY s.position) FROM trip_selections s WHERE s.trip_id=t.id),'[]'::jsonb) AS selected_place_ids,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('date',d.date::text,'items',
        COALESCE((SELECT jsonb_agg(jsonb_build_object('placeId',i.place_id,'position',i.position,'startTime',i.start_time,
          'durationMinutes',i.duration_minutes,'travelMinutesFromPrevious',i.travel_minutes_from_previous,
          'travelTimeSource',i.travel_time_source,'reason',i.reason) ORDER BY i.position)
          FROM trip_items i WHERE i.trip_id=d.trip_id AND i.date=d.date),'[]'::jsonb)) ORDER BY d.date)
        FROM trip_days d WHERE d.trip_id=t.id),'[]'::jsonb) AS days FROM trips t;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE trips ADD COLUMN selected_place_ids jsonb NOT NULL DEFAULT '[]', ADD COLUMN days jsonb NOT NULL DEFAULT '[]';
    UPDATE trips t SET selected_place_ids=v.selected_place_ids,days=v.days FROM trip_resources v WHERE t.id=v.id;
    DROP VIEW trip_resources;
    DROP TABLE trip_items,trip_days,trip_selections;
    ALTER TABLE trips DROP CONSTRAINT trips_city_fk;
    ALTER TABLE trips DROP CONSTRAINT trips_id_city_unique;
    DROP TABLE places,destinations;
  `);
};
