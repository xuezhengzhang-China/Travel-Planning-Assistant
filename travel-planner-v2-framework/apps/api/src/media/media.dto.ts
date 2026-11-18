import { ApiError } from '../common/api-error';
import { detectMimeType, MAX_PHOTO_BYTES, type UploadedMedia } from '../footprints/footprints.dto';

export const MAX_MEDIA_BYTES = MAX_PHOTO_BYTES;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ValidatedMediaUpload {
  file: UploadedMedia;
  mimeType: string;
}

/** 手账图片只接受真实 JPEG/PNG/WebP，按文件签名判断，不信任文件名或声明类型。 */
export function validateMediaUpload(file: UploadedMedia | undefined): ValidatedMediaUpload {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new ApiError('VALIDATION_ERROR', 'file is required', 400);
  }
  const detected = detectMimeType(file.buffer);
  if (!detected || !IMAGE_MIME_TYPES.has(detected)) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', '仅支持 JPEG、PNG、WebP 图片', 415);
  }
  if (file.mimetype && file.mimetype !== detected) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', '文件类型与内容不一致', 415);
  }
  if (file.size > MAX_MEDIA_BYTES) {
    throw new ApiError('FILE_TOO_LARGE', '图片不能超过 10 MiB', 413);
  }
  return { file, mimeType: detected };
}
