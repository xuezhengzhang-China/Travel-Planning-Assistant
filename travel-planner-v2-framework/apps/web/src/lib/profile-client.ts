/**
 * 个人资料接口（`GET` / `PATCH /api/users/me`）。
 *
 * 这是“统一客户端”的第一个真实调用方：它只依赖 `ApiClient`，自己不管 token、
 * 不管 HTTP 状态码，因此可以直接用假 fetcher 做纯逻辑测试。
 */

import type { PublicUser } from '@travel/shared';
import { ApiError, type ApiClient } from './api-client';

/** 与后端 `users.controller.ts` 的 `requiredString(body.displayName, 'displayName', 1, 80)` 对齐。 */
export const MAX_DISPLAY_NAME = 80;

/** 本地先校验一次，省掉一次必然失败的请求；错误码与后端保持一致。 */
export function normalizeDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError(400, 'VALIDATION_ERROR', '昵称不能为空');
  if (trimmed.length > MAX_DISPLAY_NAME) {
    throw new ApiError(400, 'VALIDATION_ERROR', `昵称最多 ${MAX_DISPLAY_NAME} 个字符`);
  }
  return trimmed;
}

export interface ProfileApi {
  getMe(): Promise<PublicUser>;
  rename(displayName: string): Promise<PublicUser>;
}

export function createProfileApi(client: ApiClient): ProfileApi {
  return {
    getMe: () => client.request<PublicUser>('/users/me'),
    // 用 async 包一层：本地校验失败也走 Promise 拒绝，调用方只需一套 try/catch。
    rename: async (displayName) =>
      client.request<PublicUser>('/users/me', {
        method: 'PATCH',
        body: { displayName: normalizeDisplayName(displayName) },
      }),
  };
}

/**
 * 把异常翻成人话。
 *
 * 注意这里**按 `code` 分支而不是只按状态码**：统一客户端保证后端错误码会原样透传，
 * 所以 `UNAUTHENTICATED`、`VALIDATION_ERROR`、`NETWORK_ERROR` 能被区分开。
 */
export function profileErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '登录已过期，请重新登录。';
    if (error.code === 'NETWORK_ERROR') return error.message;
    if (error.code === 'VALIDATION_ERROR') return error.message;
    return error.message;
  }
  if (error instanceof TypeError) return '无法连接服务器，请检查后端是否启动。';
  return error instanceof Error ? error.message : '请求未完成，请重试。';
}
