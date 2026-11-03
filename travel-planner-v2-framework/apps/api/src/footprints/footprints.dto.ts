import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { CoordinateSystem, CreateFootprintInput, FootprintEntry } from '@travel/shared' with {
  'resolution-mode': 'import',
};

export interface UploadedMedia {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = MAX_VIDEO_BYTES;
export const MAX_TEXT_LENGTH = 10000;

export interface ValidatedFootprintInput extends Omit<CreateFootprintInput, 'text'> {
  text: string | null;
}

export interface ValidatedUpload {
  kind: 'photo' | 'video';
  mimeType: string;
}

export interface ValidatedFootprintUpdate {
  input: ValidatedFootprintInput;
  removeMedia: boolean;
  locationChanged: boolean;
}

export function currentShanghaiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validateFootprintInput(
  body: Record<string, unknown>,
  hasFile: boolean,
  now = new Date(),
): ValidatedFootprintInput {
  const allowedFields = new Set([
    'text',
    'longitude',
    'latitude',
    'coordinateSystem',
    'recordedOn',
    'poiId',
  ]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('Unexpected footprint field');
  }
  if (
    (typeof body.longitude !== 'string' && typeof body.longitude !== 'number') ||
    (typeof body.longitude === 'string' && !body.longitude.trim()) ||
    (typeof body.latitude !== 'string' && typeof body.latitude !== 'number') ||
    (typeof body.latitude === 'string' && !body.latitude.trim())
  ) {
    throw new BadRequestException('longitude and latitude are required');
  }
  const longitude = Number(body.longitude);
  const latitude = Number(body.latitude);
  const coordinateSystem = body.coordinateSystem;
  const recordedOn = body.recordedOn;
  const poiId = typeof body.poiId === 'string' ? body.poiId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new BadRequestException('longitude must be a valid coordinate');
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new BadRequestException('latitude must be a valid coordinate');
  }
  if (coordinateSystem !== 'GCJ-02' && coordinateSystem !== 'WGS-84') {
    throw new BadRequestException('coordinateSystem must be GCJ-02 or WGS-84');
  }
  if (typeof recordedOn !== 'string' || !isValidDate(recordedOn)) {
    throw new BadRequestException('recordedOn must be a valid YYYY-MM-DD date');
  }
  if (poiId && (poiId.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(poiId))) {
    throw new BadRequestException('poiId is invalid');
  }
  if (recordedOn > currentShanghaiDate(now)) {
    throw new BadRequestException('recordedOn cannot be in the future');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new BadRequestException(`text must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  if (!text && !hasFile) {
    throw new BadRequestException('Add text or attach a photo or video');
  }

  return {
    longitude,
    latitude,
    coordinateSystem: coordinateSystem as CoordinateSystem,
    recordedOn,
    text: text || null,
    ...(poiId ? { poiId } : {}),
  };
}

export function validateFootprintUpdate(
  body: Record<string, unknown>,
  hasFile: boolean,
  existing: FootprintEntry,
  now = new Date(),
): ValidatedFootprintUpdate {
  const allowedFields = new Set([
    'text',
    'longitude',
    'latitude',
    'coordinateSystem',
    'recordedOn',
    'poiId',
    'removeMedia',
  ]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('Unexpected footprint field');
  }
  const hasLongitude = Object.hasOwn(body, 'longitude');
  const hasLatitude = Object.hasOwn(body, 'latitude');
  const hasCoordinateSystem = Object.hasOwn(body, 'coordinateSystem');
  if (
    (hasLongitude || hasLatitude || hasCoordinateSystem) &&
    !(hasLongitude && hasLatitude && hasCoordinateSystem)
  ) {
    throw new BadRequestException(
      'longitude, latitude, and coordinateSystem must be updated together',
    );
  }
  if (
    body.removeMedia !== undefined &&
    typeof body.removeMedia !== 'boolean' &&
    body.removeMedia !== 'true' &&
    body.removeMedia !== 'false'
  ) {
    throw new BadRequestException('removeMedia must be a boolean');
  }
  const removeMedia = body.removeMedia === true || body.removeMedia === 'true';
  if (removeMedia && hasFile) {
    throw new BadRequestException('Cannot replace and remove media in the same request');
  }
  if (body.poiId !== undefined && body.poiId !== null && typeof body.poiId !== 'string') {
    throw new BadRequestException('poiId must be a string or null');
  }
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') {
    throw new BadRequestException('text must be a string or null');
  }

  const merged: Record<string, unknown> = {
    longitude: existing.longitude,
    latitude: existing.latitude,
    coordinateSystem: existing.coordinateSystem,
    recordedOn: existing.recordedOn,
    text: existing.text ?? '',
  };
  const coordinatesChanged = hasLongitude || hasLatitude || hasCoordinateSystem;
  if (body.poiId === undefined && !coordinatesChanged) {
    if (existing.poiId) merged.poiId = existing.poiId;
  } else if (body.poiId !== null && body.poiId !== '') {
    merged.poiId = body.poiId;
  }
  for (const field of [
    'longitude',
    'latitude',
    'coordinateSystem',
    'recordedOn',
    'text',
  ] as const) {
    if (body[field] !== undefined) merged[field] = body[field];
  }

  return {
    input: validateFootprintInput(
      merged,
      hasFile || (existing.media !== null && !removeMedia),
      now,
    ),
    removeMedia,
    locationChanged: coordinatesChanged || body.poiId !== undefined,
  };
}

export function validateUpload(file: UploadedMedia): ValidatedUpload {
  const { buffer } = file;
  const detectedMimeType = detectMimeType(buffer);
  if (!detectedMimeType) {
    throw new UnsupportedMediaTypeException(
      'Only JPEG, PNG, WebP, MP4, and WebM files are supported',
    );
  }
  if (file.mimetype !== detectedMimeType) {
    throw new UnsupportedMediaTypeException('Uploaded file type does not match its contents');
  }
  const isVideo = detectedMimeType.startsWith('video/');
  if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES)) {
    throw new PayloadTooLargeException(
      isVideo ? 'Videos must be 100 MiB or smaller' : 'Photos must be 10 MiB or smaller',
    );
  }
  return { kind: isVideo ? 'video' : 'photo', mimeType: detectedMimeType };
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return 'video/webm';
  }
  return null;
}
