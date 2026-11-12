import { Injectable, PipeTransform } from '@nestjs/common';
import { ApiError } from './api-error';

export type JsonObject = Record<string, unknown>;

@Injectable()
export class JsonBodyPipe implements PipeTransform<unknown, JsonObject> {
  transform(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError('VALIDATION_ERROR', '请求体必须是 JSON 对象', 400);
    }
    return value as JsonObject;
  }
}

export function rejectUnknownFields(value: JsonObject, allowed: string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new ApiError('VALIDATION_ERROR', '请求包含未知字段', 400, { fields: unknown });
  }
}

export function requiredString(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length < minLength ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    throw new ApiError('VALIDATION_ERROR', `${field} 格式不正确`, 400, { field });
  }
  return value;
}
