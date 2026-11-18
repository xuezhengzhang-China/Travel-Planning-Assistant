/**
 * 足迹多媒体：去掉 footprint_media 的 entry_id 唯一约束，允许多个媒体；
 * 增加 position 列用于稳定排序。
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE footprint_media DROP CONSTRAINT IF EXISTS footprint_media_entry_id_key;
    ALTER TABLE footprint_media ADD COLUMN position integer NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS footprint_media_entry_id_position_idx ON footprint_media (entry_id, position);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS footprint_media_entry_id_position_idx;
    ALTER TABLE footprint_media DROP COLUMN IF EXISTS position;
    ALTER TABLE footprint_media ADD CONSTRAINT footprint_media_entry_id_key UNIQUE (entry_id);
  `);
};
