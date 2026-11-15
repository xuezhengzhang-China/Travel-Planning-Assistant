/**
 * 把浏览器选中的图片压缩成可直接上传的 JPEG。
 *
 * 为什么需要：手机照片常见 3–8 MB，直接上传又慢又容易撞上后端 10 MiB 限制。
 * 这里统一缩到最长边 1600px、JPEG 质量 0.8，供 `POST /api/media` 使用。
 *
 * 两个必须知道的耦合点：
 * 1. `MAX_IMAGE_BYTES` 必须与后端 `apps/api/src/media/media.dto.ts` 的
 *    `MAX_MEDIA_BYTES`（= `MAX_PHOTO_BYTES` = 10 MiB）一致，否则前端放行、
 *    后端 413。
 * 2. 输出固定为 `image/jpeg`，因此必然通过后端 `detectMimeType` 的 magic bytes
 *    校验；不要改成输出 WebP 或沿用原始格式，透明 PNG 已经在画布上铺了白底。
 *
 * 逻辑来源：`origin/liuyan` 分支 `Travel-Journal.tsx` 的 `preparePhoto`，
 * 改造为返回 `File`（可直接 `FormData.append('file', …)`）并补齐校验与兜底。
 */

/** 压缩产物的硬上限，与后端 10 MiB 对齐。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 解码前允许的最大输入体积；超过它就不再尝试解码，避免卡死浏览器。 */
export const MAX_INPUT_BYTES = 24 * 1024 * 1024;
/** 压缩后的最长边像素。 */
export const MAX_EDGE = 1600;
/** JPEG 编码质量。 */
export const JPEG_QUALITY = 0.8;
/** 首次压缩仍超限时的重试质量。 */
const RETRY_QUALITY = 0.6;

export type ImageCompressCode = 'EMPTY' | 'NOT_IMAGE' | 'TOO_LARGE' | 'DECODE_FAILED';

const MESSAGES: Record<ImageCompressCode, string> = {
  EMPTY: '这个文件是空的，请重新选择图片。',
  NOT_IMAGE: '只支持 JPG / PNG / WebP 图片。',
  TOO_LARGE: '图片太大，压缩后仍超过 10 MB，请换一张或先手动压缩。',
  DECODE_FAILED: '图片无法解码，请先转成 JPG 再上传。',
};

export class ImageCompressError extends Error {
  readonly code: ImageCompressCode;

  constructor(code: ImageCompressCode) {
    super(MESSAGES[code]);
    this.code = code;
    this.name = 'ImageCompressError';
  }
}

/**
 * 等比缩放到最长边不超过 `maxEdge`，返回整数像素且最小为 1。
 *
 * 宽高非法（NaN、0、负数、Infinity）时退回 1×1，绝不把 0 或 NaN 交给 canvas
 * ——`canvas.width = 0` 会静默画不出东西，排查起来很痛苦。
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return { width: 1, height: 1 };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const longest = Math.max(width, height);
  const scale = longest <= maxEdge ? 1 : maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 上传前的静态校验：空文件、非图片、超过 `limitBytes` 都会抛错。
 *
 * 默认上限是 `MAX_INPUT_BYTES`（24 MiB）而不是 10 MiB，因为 12 MB 的原图压缩后
 * 通常只有几百 KB —— 先压缩再判断，比直接拒收更符合用户预期。压缩后仍然超限的
 * 情况由 `compressImageFile` 抛 `TOO_LARGE`。
 */
export function validateImageFile(
  file: { type: string; size: number },
  limitBytes: number = MAX_INPUT_BYTES,
): void {
  if (!Number.isFinite(file.size) || file.size <= 0) throw new ImageCompressError('EMPTY');
  if (typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    throw new ImageCompressError('NOT_IMAGE');
  }
  if (file.size > limitBytes) throw new ImageCompressError('TOO_LARGE');
}

interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  release: () => void;
}

async function decode(file: File): Promise<DecodedImage> {
  // HEIC 等浏览器无法解码的格式会在这里或下面的 <img> 路径抛 DECODE_FAILED。
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        release: () => bitmap.close(),
      };
    } catch {
      /* 退回到 <img> 解码，兼容不支持 createImageBitmap 的实现。 */
    }
  }
  return decodeWithElement(file);
}

function decodeWithElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        cleanup();
        reject(new ImageCompressError('DECODE_FAILED'));
        return;
      }
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        source: image,
        release: cleanup,
      });
    };
    image.onerror = () => {
      cleanup();
      reject(new ImageCompressError('DECODE_FAILED'));
    };
    image.src = url;
  });
}

function render(
  source: CanvasImageSource,
  size: { width: number; height: number },
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new ImageCompressError('DECODE_FAILED'));
  // 透明 PNG 转 JPEG 之前必须铺白底，否则透明区域会变成黑块。
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(source, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ImageCompressError('DECODE_FAILED'));
      },
      'image/jpeg',
      quality,
    );
  });
}

function toJpegFile(blob: Blob, originalName: string): File {
  const stem = originalName.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${stem}.jpg`, { type: 'image/jpeg' });
}

/**
 * 压缩为 JPEG 并返回可直接放进 `FormData` 的 `File`。
 *
 * 流程：静态校验 → 解码 → 等比缩放 → 白底合成 → JPEG 编码。首次编码仍超过
 * 10 MiB 时用 0.6 质量重试一次，仍然超限才抛 `TOO_LARGE`。
 */
export async function compressImageFile(file: File): Promise<File> {
  validateImageFile(file);
  const decoded = await decode(file);
  try {
    const size = fitWithin(decoded.width, decoded.height);
    const first = await render(decoded.source, size, JPEG_QUALITY);
    if (first.size <= MAX_IMAGE_BYTES) return toJpegFile(first, file.name);
    const retry = await render(decoded.source, size, RETRY_QUALITY);
    if (retry.size <= MAX_IMAGE_BYTES) return toJpegFile(retry, file.name);
    throw new ImageCompressError('TOO_LARGE');
  } finally {
    decoded.release();
  }
}
