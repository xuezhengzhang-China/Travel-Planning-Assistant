import type { LoginResponse, PublicUser } from '@travel/shared';
import { TripApiError } from './trip-draft-client';
// 仅供独立入口使用，正式软件可直接注入现有登录状态。
export function createSessionClient(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
    const response = await fetcher(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new TripApiError(
        response.status,
        data?.code ?? 'HTTP_ERROR',
        data?.message ?? '登录服务暂时不可用',
      );
    if (!data) throw new Error('登录服务返回无效响应');
    return data as T;
  }
  return {
    login: (email: string, password: string) =>
      request<LoginResponse>('/auth/login', { email, password }),
    register: (email: string, password: string, displayName: string) =>
      request('/auth/register', { email, password, displayName }),
    me: (token: string) => request<PublicUser>('/users/me', undefined, token),
  };
}
