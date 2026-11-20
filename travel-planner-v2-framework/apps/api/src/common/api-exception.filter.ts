import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiError } from './api-error';
import { MAX_FOOTPRINT_MEDIA } from '../footprints/footprints.dto';

/**
 * 统一错误契约：
 * - 4xx 一律保留具体原因，用户才知道该改哪个字段；
 * - 5xx 只给通用文案，内部细节留在日志里；
 * - 响应形状始终是 { code, message, details? }。
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ path: string }>();
    const response = http.getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();

    // Keep the existing readiness endpoint response contract intact.
    if (request.path === '/api/ready' && exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      });
      return;
    }

    // multer 在进入控制器之前就抛错（附件过多、文件过大、字段名不对），
    // 它不是 HttpException，原来会掉进未知异常分支变成 500。这里按统一契约转成 400。
    const uploadMessage = multerMessage(exception);
    if (uploadMessage) {
      response.status(HttpStatus.BAD_REQUEST).json({
        code: 'VALIDATION_ERROR',
        message: uploadMessage,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        this.logger.error(`Request failed with ${status}`);
        response.status(status).json({ code: 'HTTP_ERROR', message: '服务器暂时无法处理请求' });
        return;
      }
      const body = readBody(exception.getResponse());
      const code = typeof body?.code === 'string' ? body.code : defaultCode(status);
      const details = body?.details;
      response.status(status).json({
        code,
        message: translateUploadMessage(readMessage(body?.message, exception.message)),
        ...(details ? { details } : {}),
      });
      return;
    }

    this.logger.error('Unexpected request failure');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    });
  }
}

function readBody(response: string | object): Record<string, unknown> | null {
  return typeof response === 'object' && response !== null
    ? (response as Record<string, unknown>)
    : null;
}

/** Nest 的 ValidationPipe / ParseUUIDPipe 会把多条原因放进数组，这里拼成一句话。 */
function readMessage(raw: unknown, fallback: string): string {
  if (Array.isArray(raw)) {
    const parts = raw.filter((item): item is string => typeof item === 'string');
    if (parts.length) return parts.join('；');
  }
  if (typeof raw === 'string' && raw.trim() && raw !== 'Bad Request Exception') return raw;
  return fallback || '请求未能处理';
}

function defaultCode(status: number): string {
  if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHENTICATED';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) return 'FILE_TOO_LARGE';
  if (status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  if (status === HttpStatus.GONE) return 'GONE';
  return 'REQUEST_FAILED';
}

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_COUNT: `一条足迹最多 ${MAX_FOOTPRINT_MEDIA} 个附件，请减少后重试`,
  LIMIT_FILE_SIZE: '单个附件过大：照片最多 10 MiB，视频最多 100 MiB',
  LIMIT_UNEXPECTED_FILE: '上传字段名不正确，请使用 files',
  LIMIT_PART_COUNT: '表单字段过多，请精简后重试',
  LIMIT_FIELD_COUNT: '表单字段过多，请精简后重试',
  LIMIT_FIELD_KEY: '表单字段名过长',
  LIMIT_FIELD_VALUE: '表单字段值过长',
};

/** multer 的错误没有继承 HttpException，只能按 name/code 识别。 */
function multerMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== 'MulterError') return null;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  return MULTER_MESSAGES[code] ?? '上传的文件不符合要求';
}

/**
 * Nest 的 FileInterceptor 会把 multer 错误包成 BadRequestException('Too many files')，
 * 到这一步已经是英文通用文案。这里把已知的上传错误翻成中文，保持契约一致。
 */
const UPLOAD_MESSAGE_MAP: Record<string, string> = {
  'Too many files': MULTER_MESSAGES.LIMIT_FILE_COUNT,
  'File too large': MULTER_MESSAGES.LIMIT_FILE_SIZE,
  'Unexpected field': MULTER_MESSAGES.LIMIT_UNEXPECTED_FILE,
};

function translateUploadMessage(message: string): string {
  return UPLOAD_MESSAGE_MAP[message] ?? message;
}
