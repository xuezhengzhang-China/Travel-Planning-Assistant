import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  FootprintEntry,
  FootprintMapCity,
  FootprintMapData,
  FootprintMapLocation,
  FootprintMapProvince,
  FootprintListPage,
  FootprintMedia,
} from '@travel/shared' with { 'resolution-mode': 'import' };
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AmapLocationService, type ResolvedFootprintLocation } from './amap-location.service';
import { MediaStorageService } from './media-storage.service';
import type {
  UploadedMedia,
  ValidatedFootprintInput,
  ValidatedFootprintUpdate,
  ValidatedUpload,
} from './footprints.dto';

const logger = new Logger('FootprintsService');

interface EntryRow {
  id: string;
  text_content: string | null;
  longitude: number;
  latitude: number;
  coordinate_system: 'GCJ-02' | 'WGS-84';
  place_name: string | null;
  place_address: string | null;
  poi_id: string | null;
  map_longitude: number | null;
  map_latitude: number | null;
  province_name: string | null;
  province_adcode: string | null;
  city_name: string | null;
  city_adcode: string | null;
  recorded_on: string;
  created_at: Date;
  updated_at: Date;
}

interface MediaRow {
  id: string;
  kind: 'photo' | 'video';
  original_name: string;
  mime_type: string;
  size_bytes: string | number;
  created_at: Date;
  storage_key: string;
}

interface JoinedEntryRow extends EntryRow {
  media_id: string | null;
  media_kind: 'photo' | 'video' | null;
  media_original_name: string | null;
  media_mime_type: string | null;
  media_size_bytes: string | number | null;
  media_created_at: Date | null;
  media_storage_key: string | null;
}

interface LocationGroup {
  id: string;
  poiId: string | null;
  rows: EntryRow[];
  anchor: EntryRow;
}

@Injectable()
export class FootprintsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: MediaStorageService,
    private readonly amap: AmapLocationService,
  ) {}

  async create(
    ownerId: string,
    input: ValidatedFootprintInput,
    file?: UploadedMedia,
    upload?: ValidatedUpload,
  ): Promise<FootprintEntry> {
    if (Boolean(file) !== Boolean(upload)) {
      throw new Error('Uploaded media validation result is required');
    }
    const location = await this.amap.resolve(
      input.longitude,
      input.latitude,
      input.coordinateSystem,
      input.poiId ?? null,
    );
    const entryId = randomUUID();
    const mediaId = file ? randomUUID() : null;
    const storageKey =
      file && upload ? await this.storage.write(file.buffer, upload.mimeType) : null;
    try {
      const created = await this.database.transaction(async (client) => {
        const entry = await this.insertEntry(client, entryId, ownerId, input, location);
        const media =
          file && upload && mediaId && storageKey
            ? await this.insertMedia(client, entryId, ownerId, mediaId, storageKey, file, upload)
            : null;
        return toFootprintEntry(entry, media);
      });
      await this.drainMediaCleanupQueue();
      return created;
    } catch (error) {
      if (storageKey) {
        try {
          await this.storage.delete(storageKey);
        } catch (cleanupError) {
          logger.error('Failed to remove media file after footprint save failed', cleanupError);
          await this.scheduleMediaCleanup(storageKey);
        }
      }
      throw error;
    }
  }

  async list(
    ownerId: string,
    year: number | null,
    page: number,
    pageSize: number,
  ): Promise<FootprintListPage> {
    const filter = year === null ? '' : ' AND EXTRACT(YEAR FROM e.recorded_on) = $2';
    const filterValues: unknown[] = year === null ? [ownerId] : [ownerId, year];
    const countResult = await this.database.query<{ total: string | number }>(
      `SELECT COUNT(*) AS total FROM footprint_entries e WHERE e.owner_id = $1${filter}`,
      filterValues,
    );
    const offset = (page - 1) * pageSize;
    const rowsResult = await this.database.query<JoinedEntryRow>(
      `${joinedEntrySelect}
       WHERE e.owner_id = $1${filter}
       ORDER BY e.recorded_on DESC, e.created_at DESC, e.id
       LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
      [...filterValues, pageSize, offset],
    );
    return {
      items: rowsResult.rows.map(toJoinedFootprintEntry),
      page,
      pageSize,
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }

  async getById(ownerId: string, entryId: string): Promise<FootprintEntry> {
    const result = await this.database.query<JoinedEntryRow>(
      `${joinedEntrySelect} WHERE e.id = $1 AND e.owner_id = $2`,
      [entryId, ownerId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Footprint not found' });
    return toJoinedFootprintEntry(row);
  }

  async update(
    ownerId: string,
    entryId: string,
    update: ValidatedFootprintUpdate,
    file?: UploadedMedia,
    upload?: ValidatedUpload,
  ): Promise<FootprintEntry> {
    if (Boolean(file) !== Boolean(upload)) {
      throw new Error('Uploaded media validation result is required');
    }
    const { input, removeMedia } = update;
    const resolvedLocation = update.locationChanged
      ? await this.amap.resolve(
          input.longitude,
          input.latitude,
          input.coordinateSystem,
          input.poiId ?? null,
        )
      : null;
    const storageKey =
      file && upload ? await this.storage.write(file.buffer, upload.mimeType) : null;
    try {
      const updated = await this.database.transaction(async (client) => {
        const ownedEntry = await client.query<EntryRow>(
          `SELECT id, text_content, longitude, latitude, coordinate_system,
                  place_name, place_address, poi_id, map_longitude, map_latitude,
                  province_name, province_adcode, city_name, city_adcode,
                  recorded_on::text AS recorded_on, created_at, updated_at
           FROM footprint_entries WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
          [entryId, ownerId],
        );
        const currentEntry = ownedEntry.rows[0];
        if (!currentEntry) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Footprint not found' });
        }
        const oldMediaResult = await client.query<MediaRow>(
          `SELECT id, kind, original_name, mime_type, size_bytes, created_at, storage_key
           FROM footprint_media WHERE entry_id = $1 AND owner_id = $2 FOR UPDATE`,
          [entryId, ownerId],
        );
        const oldMedia = oldMediaResult.rows[0] ?? null;
        if (oldMedia && (removeMedia || storageKey)) {
          await this.queueMediaCleanup(client, oldMedia.storage_key);
          await client.query('DELETE FROM footprint_media WHERE id = $1 AND owner_id = $2', [
            oldMedia.id,
            ownerId,
          ]);
        }
        const entry = await this.updateEntry(
          client,
          entryId,
          ownerId,
          input,
          resolvedLocation ?? resolvedLocationFromEntry(currentEntry),
        );
        const media =
          file && upload && storageKey
            ? await this.insertMedia(
                client,
                entryId,
                ownerId,
                randomUUID(),
                storageKey,
                file,
                upload,
              )
            : oldMedia && !removeMedia
              ? oldMedia
              : null;
        return toFootprintEntry(entry, media);
      });
      await this.drainMediaCleanupQueue();
      return updated;
    } catch (error) {
      if (storageKey) await this.removeOrQueueMedia(storageKey);
      throw error;
    }
  }

  async delete(ownerId: string, entryId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const entry = await client.query<{ id: string }>(
        'SELECT id FROM footprint_entries WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [entryId, ownerId],
      );
      if (!entry.rows[0]) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Footprint not found' });
      }
      const media = await client.query<{ storage_key: string }>(
        'SELECT storage_key FROM footprint_media WHERE entry_id = $1 AND owner_id = $2 FOR UPDATE',
        [entryId, ownerId],
      );
      for (const row of media.rows) await this.queueMediaCleanup(client, row.storage_key);
      await client.query('DELETE FROM footprint_entries WHERE id = $1 AND owner_id = $2', [
        entryId,
        ownerId,
      ]);
    });
    await this.drainMediaCleanupQueue();
  }

  async searchPlaces(keyword: string) {
    return this.amap.searchPlaces(keyword);
  }

  async getMapData(
    ownerId: string,
    provinceAdcode: string | null,
    year: number | null = null,
  ): Promise<FootprintMapData> {
    const result = await this.database.query<EntryRow>(
      `SELECT id, text_content, longitude, latitude, coordinate_system,
              place_name, place_address, poi_id, map_longitude, map_latitude,
              province_name, province_adcode, city_name, city_adcode,
              recorded_on::text AS recorded_on, created_at, updated_at
       FROM footprint_entries
       WHERE owner_id = $1
         AND ($2::integer IS NULL OR EXTRACT(YEAR FROM recorded_on) = $2)
       ORDER BY created_at, id`,
      [ownerId, year],
    );
    const entries = result.rows;
    const locations = groupLocations(entries);
    const provinces = summarizeProvinces(entries, locations);
    const cities = summarizeCities(entries, locations);

    return {
      summary: {
        provinceCount: provinces.length,
        cityCount: cities.length,
        locationCount: locations.length,
        checkInCount: entries.length,
      },
      provinces: provinceAdcode ? [] : provinces,
      cities: provinceAdcode ? cities.filter((city) => city.provinceAdcode === provinceAdcode) : [],
      locations: provinceAdcode
        ? locations
            .filter((location) => location.anchor.province_adcode === provinceAdcode)
            .map(toMapLocation)
        : [],
    };
  }

  async readMedia(ownerId: string, mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const result = await this.database.query<MediaRow>(
      `SELECT m.storage_key, m.mime_type, m.id, m.kind, m.original_name, m.size_bytes, m.created_at
       FROM footprint_media m
       JOIN footprint_entries e ON e.id = m.entry_id
       WHERE m.id = $1 AND e.owner_id = $2`,
      [mediaId, ownerId],
    );
    const media = result.rows[0];
    if (!media) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Media not found' });
    return { bytes: await this.storage.read(media.storage_key), mimeType: media.mime_type };
  }

  private async insertEntry(
    client: PoolClient,
    id: string,
    ownerId: string,
    input: ValidatedFootprintInput,
    location: ResolvedFootprintLocation,
  ): Promise<EntryRow> {
    const result = await client.query<EntryRow>(
      `INSERT INTO footprint_entries
         (id, owner_id, text_content, longitude, latitude, coordinate_system, recorded_on,
          place_name, place_address, poi_id, map_longitude, map_latitude,
          province_name, province_adcode, city_name, city_adcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, text_content, longitude, latitude, coordinate_system,
                 place_name, place_address, poi_id, map_longitude, map_latitude,
                 province_name, province_adcode, city_name, city_adcode,
                 recorded_on::text AS recorded_on, created_at, updated_at`,
      [
        id,
        ownerId,
        input.text,
        location.longitude,
        location.latitude,
        location.coordinateSystem,
        input.recordedOn,
        location.placeName,
        location.placeAddress,
        location.poiId,
        location.mapLongitude,
        location.mapLatitude,
        location.provinceName,
        location.provinceAdcode,
        location.cityName,
        location.cityAdcode,
      ],
    );
    return result.rows[0];
  }

  private async updateEntry(
    client: PoolClient,
    id: string,
    ownerId: string,
    input: ValidatedFootprintInput,
    location: ResolvedFootprintLocation,
  ): Promise<EntryRow> {
    const result = await client.query<EntryRow>(
      `UPDATE footprint_entries
       SET text_content = $3, longitude = $4, latitude = $5, coordinate_system = $6,
           recorded_on = $7, place_name = $8, place_address = $9, poi_id = $10,
           map_longitude = $11, map_latitude = $12, province_name = $13,
           province_adcode = $14, city_name = $15, city_adcode = $16,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND owner_id = $2
       RETURNING id, text_content, longitude, latitude, coordinate_system,
                 place_name, place_address, poi_id, map_longitude, map_latitude,
                 province_name, province_adcode, city_name, city_adcode,
                 recorded_on::text AS recorded_on, created_at, updated_at`,
      [
        id,
        ownerId,
        input.text,
        location.longitude,
        location.latitude,
        location.coordinateSystem,
        input.recordedOn,
        location.placeName,
        location.placeAddress,
        location.poiId,
        location.mapLongitude,
        location.mapLatitude,
        location.provinceName,
        location.provinceAdcode,
        location.cityName,
        location.cityAdcode,
      ],
    );
    const entry = result.rows[0];
    if (!entry) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Footprint not found' });
    return entry;
  }

  private async insertMedia(
    client: PoolClient,
    entryId: string,
    ownerId: string,
    id: string,
    storageKey: string,
    file: UploadedMedia,
    upload: ValidatedUpload,
  ): Promise<MediaRow> {
    const originalName = file.originalname.replace(/^.*[\\/]/, '').slice(0, 255) || 'upload';
    const result = await client.query<MediaRow>(
      `INSERT INTO footprint_media
         (id, entry_id, owner_id, storage_key, kind, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, kind, original_name, mime_type, size_bytes, created_at, storage_key`,
      [id, entryId, ownerId, storageKey, upload.kind, originalName, upload.mimeType, file.size],
    );
    return result.rows[0];
  }

  private async queueMediaCleanup(client: PoolClient, storageKey: string): Promise<void> {
    await client.query(
      `INSERT INTO footprint_media_cleanup (storage_key)
       VALUES ($1) ON CONFLICT (storage_key) DO NOTHING`,
      [storageKey],
    );
  }

  private async scheduleMediaCleanup(storageKey: string): Promise<void> {
    try {
      await this.database.query(
        `INSERT INTO footprint_media_cleanup (storage_key)
         VALUES ($1) ON CONFLICT (storage_key) DO NOTHING`,
        [storageKey],
      );
    } catch (error) {
      logger.error('Failed to persist media cleanup task', error);
    }
  }

  private async removeOrQueueMedia(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      logger.error('Failed to remove media after footprint update failed', error);
      await this.scheduleMediaCleanup(storageKey);
    }
  }

  private async drainMediaCleanupQueue(): Promise<void> {
    let pending: { rows: { storage_key: string }[] };
    try {
      pending = await this.database.query<{ storage_key: string }>(
        'SELECT storage_key FROM footprint_media_cleanup ORDER BY created_at LIMIT 100',
      );
    } catch (error) {
      logger.warn(
        `Could not read media cleanup queue: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return;
    }
    for (const { storage_key: storageKey } of pending.rows) {
      try {
        await this.storage.delete(storageKey);
        await this.database.query('DELETE FROM footprint_media_cleanup WHERE storage_key = $1', [
          storageKey,
        ]);
      } catch (error) {
        logger.warn(
          `Media cleanup remains pending for ${storageKey}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }
}

const joinedEntrySelect = `SELECT e.id, e.text_content, e.longitude, e.latitude, e.coordinate_system,
       e.place_name, e.place_address, e.poi_id, e.map_longitude, e.map_latitude,
       e.province_name, e.province_adcode, e.city_name, e.city_adcode,
       e.recorded_on::text AS recorded_on, e.created_at, e.updated_at,
       m.id AS media_id, m.kind AS media_kind, m.original_name AS media_original_name,
       m.mime_type AS media_mime_type, m.size_bytes AS media_size_bytes,
       m.created_at AS media_created_at, m.storage_key AS media_storage_key
       FROM footprint_entries e
       LEFT JOIN footprint_media m ON m.entry_id = e.id AND m.owner_id = e.owner_id`;

function toJoinedFootprintEntry(row: JoinedEntryRow): FootprintEntry {
  const media: MediaRow | null =
    row.media_id &&
    row.media_kind &&
    row.media_original_name &&
    row.media_mime_type &&
    row.media_size_bytes !== null &&
    row.media_created_at &&
    row.media_storage_key
      ? {
          id: row.media_id,
          kind: row.media_kind,
          original_name: row.media_original_name,
          mime_type: row.media_mime_type,
          size_bytes: row.media_size_bytes,
          created_at: row.media_created_at,
          storage_key: row.media_storage_key,
        }
      : null;
  return toFootprintEntry(row, media);
}

function resolvedLocationFromEntry(entry: EntryRow): ResolvedFootprintLocation {
  return {
    placeName: entry.place_name,
    placeAddress: entry.place_address,
    poiId: entry.poi_id,
    longitude: Number(entry.longitude),
    latitude: Number(entry.latitude),
    coordinateSystem: entry.coordinate_system,
    mapLongitude: entry.map_longitude === null ? null : Number(entry.map_longitude),
    mapLatitude: entry.map_latitude === null ? null : Number(entry.map_latitude),
    provinceName: entry.province_name,
    provinceAdcode: entry.province_adcode,
    cityName: entry.city_name,
    cityAdcode: entry.city_adcode,
  };
}

function toFootprintEntry(entry: EntryRow, media: MediaRow | null): FootprintEntry {
  const mappedMedia: FootprintMedia | null = media
    ? {
        id: media.id,
        kind: media.kind,
        originalName: media.original_name,
        mimeType: media.mime_type,
        sizeBytes: Number(media.size_bytes),
        createdAt: media.created_at.toISOString(),
      }
    : null;
  return {
    id: entry.id,
    text: entry.text_content,
    placeName: entry.place_name,
    placeAddress: entry.place_address,
    poiId: entry.poi_id,
    longitude: Number(entry.longitude),
    latitude: Number(entry.latitude),
    coordinateSystem: entry.coordinate_system,
    mapLongitude: entry.map_longitude === null ? null : Number(entry.map_longitude),
    mapLatitude: entry.map_latitude === null ? null : Number(entry.map_latitude),
    provinceName: entry.province_name,
    provinceAdcode: entry.province_adcode,
    cityName: entry.city_name,
    cityAdcode: entry.city_adcode,
    recordedOn: entry.recorded_on,
    media: mappedMedia,
    createdAt: entry.created_at.toISOString(),
    updatedAt: entry.updated_at.toISOString(),
  };
}

function groupLocations(entries: EntryRow[]): LocationGroup[] {
  const groups: LocationGroup[] = [];
  const poiGroups = new Map<string, LocationGroup>();
  for (const entry of entries) {
    if (!entry.poi_id) continue;
    const existing = poiGroups.get(entry.poi_id);
    if (existing) existing.rows.push(entry);
    else {
      const group = {
        id: `poi:${entry.poi_id}`,
        poiId: entry.poi_id,
        rows: [entry],
        anchor: entry,
      };
      poiGroups.set(entry.poi_id, group);
      groups.push(group);
    }
  }

  for (const entry of entries) {
    if (entry.poi_id) continue;
    const position = mapPosition(entry);
    const nearby = groups
      .map((group) => ({ group, distance: distanceMeters(position, mapPosition(group.anchor)) }))
      .filter(
        ({ group, distance }) =>
          position.coordinateSystem === mapPosition(group.anchor).coordinateSystem &&
          distance <= 50,
      )
      .sort((left, right) => left.distance - right.distance)[0]?.group;
    if (nearby) nearby.rows.push(entry);
    else {
      groups.push({
        id: `coordinate:${entry.id}`,
        poiId: null,
        rows: [entry],
        anchor: entry,
      });
    }
  }
  return groups;
}

function summarizeProvinces(
  entries: EntryRow[],
  locations: LocationGroup[],
): FootprintMapProvince[] {
  const citiesByProvince = new Map<string, Set<string>>();
  const checkinsByProvince = new Map<string, { name: string; count: number }>();
  for (const entry of entries) {
    if (!entry.province_adcode || !entry.province_name) continue;
    const cityCodes = citiesByProvince.get(entry.province_adcode) ?? new Set<string>();
    if (entry.city_adcode) cityCodes.add(entry.city_adcode);
    citiesByProvince.set(entry.province_adcode, cityCodes);
    const aggregate = checkinsByProvince.get(entry.province_adcode) ?? {
      name: entry.province_name,
      count: 0,
    };
    aggregate.count += 1;
    checkinsByProvince.set(entry.province_adcode, aggregate);
  }
  return [...checkinsByProvince.entries()]
    .map(([provinceAdcode, value]) => ({
      provinceAdcode,
      provinceName: value.name,
      cityCount: citiesByProvince.get(provinceAdcode)?.size ?? 0,
      locationCount: locations.filter(({ anchor }) => anchor.province_adcode === provinceAdcode)
        .length,
      checkInCount: value.count,
    }))
    .sort((left, right) => left.provinceAdcode.localeCompare(right.provinceAdcode));
}

function summarizeCities(entries: EntryRow[], locations: LocationGroup[]): FootprintMapCity[] {
  const cities = new Map<string, FootprintMapCity>();
  for (const entry of entries) {
    if (!entry.city_adcode || !entry.city_name || !entry.province_adcode || !entry.province_name) {
      continue;
    }
    const city = cities.get(entry.city_adcode) ?? {
      cityAdcode: entry.city_adcode,
      cityName: entry.city_name,
      provinceAdcode: entry.province_adcode,
      provinceName: entry.province_name,
      locationCount: 0,
      checkInCount: 0,
    };
    city.checkInCount += 1;
    cities.set(entry.city_adcode, city);
  }
  for (const location of locations) {
    const city = location.anchor.city_adcode ? cities.get(location.anchor.city_adcode) : undefined;
    if (city) city.locationCount += 1;
  }
  return [...cities.values()].sort((left, right) =>
    left.cityAdcode.localeCompare(right.cityAdcode),
  );
}

function toMapLocation(group: LocationGroup): FootprintMapLocation {
  const anchor = group.anchor;
  const position = mapPosition(anchor);
  return {
    locationId: group.id,
    poiId: group.poiId,
    placeName: anchor.place_name,
    longitude: position.longitude,
    latitude: position.latitude,
    coordinateSystem: position.coordinateSystem,
    provinceAdcode: anchor.province_adcode,
    provinceName: anchor.province_name,
    cityAdcode: anchor.city_adcode,
    cityName: anchor.city_name,
    checkInCount: group.rows.length,
  };
}

function mapPosition(entry: EntryRow): {
  longitude: number;
  latitude: number;
  coordinateSystem: 'GCJ-02' | 'WGS-84';
} {
  if (entry.map_longitude !== null && entry.map_latitude !== null) {
    return {
      longitude: Number(entry.map_longitude),
      latitude: Number(entry.map_latitude),
      coordinateSystem: 'GCJ-02',
    };
  }
  return {
    longitude: Number(entry.longitude),
    latitude: Number(entry.latitude),
    coordinateSystem: entry.coordinate_system,
  };
}

function distanceMeters(
  left: { longitude: number; latitude: number },
  right: { longitude: number; latitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.latitude)) *
      Math.cos(radians(right.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
