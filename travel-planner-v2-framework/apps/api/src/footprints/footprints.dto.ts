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
/** 一条足迹最多 100 个附件（与前端 MAX_FOOTPRINT_FILES 保持一致）。 */
export const MAX_FOOTPRINT_MEDIA = 100;
/**
 * 单次请求的附件总大小上限。
 * 附件是内存缓冲，100 个文件若每个都接近单文件上限会把进程内存打爆；
 * 300 MiB 足以放下 100 张压缩后的照片，同时挡住异常的批量大视频。
 */
export const MAX_FOOTPRINT_TOTAL_BYTES = 300 * 1024 * 1024;

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
  removeMediaIds: string[];
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
    throw new BadRequestException('包含未支持的足迹字段');
  }
  if (
    (typeof body.longitude !== 'string' && typeof body.longitude !== 'number') ||
    (typeof body.longitude === 'string' && !body.longitude.trim()) ||
    (typeof body.latitude !== 'string' && typeof body.latitude !== 'number') ||
    (typeof body.latitude === 'string' && !body.latitude.trim())
  ) {
    throw new BadRequestException('必须同时提供经度和纬度');
  }
  const longitude = Number(body.longitude);
  const latitude = Number(body.latitude);
  const coordinateSystem = body.coordinateSystem;
  const recordedOn = body.recordedOn;
  const poiId = typeof body.poiId === 'string' ? body.poiId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new BadRequestException('经度必须是 -180 到 180 之间的数字');
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new BadRequestException('纬度必须是 -90 到 90 之间的数字');
  }
  if (coordinateSystem !== 'GCJ-02' && coordinateSystem !== 'WGS-84') {
    throw new BadRequestException('坐标系必须是 GCJ-02 或 WGS-84');
  }
  if (typeof recordedOn !== 'string' || !isValidDate(recordedOn)) {
    throw new BadRequestException('日期必须是 YYYY-MM-DD 格式的有效日期');
  }
  if (poiId && (poiId.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(poiId))) {
    throw new BadRequestException('地点标识（poiId）格式不正确');
  }
  if (recordedOn > currentShanghaiDate(now)) {
    throw new BadRequestException(
      `记录日期不能晚于今天（${currentShanghaiDate(now)}），当前填写的是 ${recordedOn}`,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new BadRequestException(`文字最多 ${MAX_TEXT_LENGTH} 字，当前 ${text.length} 字`);
  }
  if (!text && !hasFile) {
    throw new BadRequestException('请填写文字，或附带一张照片/视频');
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
    'removeMediaIds',
  ]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('包含未支持的足迹字段');
  }
  const hasLongitude = Object.hasOwn(body, 'longitude');
  const hasLatitude = Object.hasOwn(body, 'latitude');
  const hasCoordinateSystem = Object.hasOwn(body, 'coordinateSystem');
  if (
    (hasLongitude || hasLatitude || hasCoordinateSystem) &&
    !(hasLongitude && hasLatitude && hasCoordinateSystem)
  ) {
    throw new BadRequestException('经度、纬度和坐标系必须同时更新');
  }
  if (
    body.removeMedia !== undefined &&
    typeof body.removeMedia !== 'boolean' &&
    body.removeMedia !== 'true' &&
    body.removeMedia !== 'false'
  ) {
    throw new BadRequestException('removeMedia 必须是布尔值');
  }
  const removeMedia = body.removeMedia === true || body.removeMedia === 'true';
  if (removeMedia && hasFile) {
    throw new BadRequestException('Cannot replace and remove media in the same request');
  }
  const removeMediaIds = parseUuidList(body.removeMediaIds);
  if (body.poiId !== undefined && body.poiId !== null && typeof body.poiId !== 'string') {
    throw new BadRequestException('poiId 必须是字符串或 null');
  }
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') {
    throw new BadRequestException('text 必须是字符串或 null');
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
      hasFile || (existing.media.length > 0 && !removeMedia),
      now,
    ),
    removeMedia,
    removeMediaIds,
    locationChanged: coordinatesChanged || body.poiId !== undefined,
  };
}

export function validateUpload(file: UploadedMedia): ValidatedUpload {
  const { buffer } = file;
  const detectedMimeType = detectMimeType(buffer);
  if (!detectedMimeType) {
    throw new UnsupportedMediaTypeException('只支持 JPEG、PNG、WebP、MP4、WebM 格式');
  }
  if (file.mimetype !== detectedMimeType) {
    throw new UnsupportedMediaTypeException('文件内容与声明的类型不一致');
  }
  const isVideo = detectedMimeType.startsWith('video/');
  if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES)) {
    throw new PayloadTooLargeException(isVideo ? '视频不能超过 100 MiB' : '照片不能超过 10 MiB');
  }
  return { kind: isVideo ? 'video' : 'photo', mimeType: detectedMimeType };
}

/**
 * 附件是内存缓冲，数量上限提高后必须同时限制单次请求的总大小，
 * 否则 100 个接近 100 MiB 的视频会直接把进程内存打爆。
 */
export function assertUploadTotalSize(files: UploadedMedia[]): void {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_FOOTPRINT_TOTAL_BYTES) {
    const limitMb = Math.round(MAX_FOOTPRINT_TOTAL_BYTES / (1024 * 1024));
    const actualMb = Math.round(total / (1024 * 1024));
    throw new PayloadTooLargeException(
      `附件总大小不能超过 ${limitMb} MB，当前约 ${actualMb} MB，请分批上传`,
    );
  }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function detectMimeType(buffer: Buffer): string | null {
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuidList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException('removeMediaIds 必须是字符串或字符串数组');
    }
    for (const part of item.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (!UUID_PATTERN.test(trimmed)) {
        throw new BadRequestException('removeMediaIds 必须是合法的 UUID');
      }
      result.push(trimmed);
    }
  }
  return [...new Set(result)];
}
