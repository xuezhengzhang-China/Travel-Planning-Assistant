/**
 * 全站统一的 HTTP 客户端。
 *
 * 解决三个重复问题（A1）：
 * 1. **token 注入**：调用方不再手写 `Authorization`，只需提供 `getAccessToken`；
 * 2. **错误码**：把后端 `{code,message,details}` 统一成 `ApiError`，页面可按 `code` 分支；
 * 3. **响应差异**：一并处理 204、非 JSON、网络失败，页面不用各写一遍 try/catch。
 *
 * 与既有客户端的关系：
 * `features/trip-create/trip-draft-client.ts` 里已有一份等价实现，为了不打断已上线的
 * 行程流程，本次**不改动它**；新代码一律使用本模块。两个客户端的错误类型字段一致
 * （`status` / `code` / `message` / `details`），页面可以统一处理。
 *
 * 约定：
 * - `baseUrl` 默认 `/api`，末尾斜杠会被去掉；
 * - `request` 默认要求登录，公开接口显式传 `auth: false`；
 * - 没有 token 时**不发起请求**，直接抛 `UNAUTHENTICATED`，避免无谓的 401 往返。
 */

/** 失败状态码：0 表示请求没有拿到任何响应（断网、后端没启动、被浏览器拦截）。 */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestInit {
  method?: string;
  /** 普通对象会序列化成 JSON；`FormData` 原样发送（不设置 Content-Type）。 */
  body?: unknown;
  signal?: AbortSignal;
  /** 默认 `true`；公开接口传 `false`，此时不会要求 token。 */
  auth?: boolean;
}

export interface ApiClientOptions {
  getAccessToken: () => string | null | Promise<string | null>;
  baseUrl?: string;
  /** 便于测试注入；默认使用全局 `fetch`。 */
  fetcher?: typeof fetch;
}

export interface ApiClient {
  request<T>(path: string, init?: ApiRequestInit): Promise<T>;
  /** 读取二进制内容（例如认证后的 `GET /api/media/:id`）。 */
  blob(path: string, init?: Omit<ApiRequestInit, 'body'>): Promise<Blob>;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetcher = options.fetcher ?? fetch;
  const base = (options.baseUrl ?? '/api').replace(/\/+$/, '');

  async function send(path: string, init: ApiRequestInit): Promise<Response> {
    const requiresAuth = init.auth !== false;
    const token = requiresAuth ? await options.getAccessToken() : null;
    if (requiresAuth && !token) {
      throw new ApiError(401, 'UNAUTHENTICATED', '登录已过期，请重新登录');
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    let body: BodyInit | undefined;
    if (isFormData(init.body)) {
      // 交给浏览器自己带 boundary，手写 Content-Type 会让后端解析失败。
      body = init.body;
    } else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    try {
      return await fetcher(`${base}${path}`, {
        method: init.method ?? (body === undefined ? 'GET' : 'POST'),
        headers,
        body,
        signal: init.signal,
      });
    } catch (error) {
      // 主动取消要保持原样，调用方靠它区分“用户离开”和“网络故障”。
      if (isAbortError(error)) throw error;
      throw new ApiError(
        NETWORK_ERROR_STATUS,
        'NETWORK_ERROR',
        '无法连接服务器，请检查网络或后端是否启动',
      );
    }
  }

  async function readError(response: Response): Promise<ApiError> {
    const payload: unknown = await response.json().catch(() => null);
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    return new ApiError(
      response.status,
      typeof record.code === 'string' ? record.code : 'HTTP_ERROR',
      typeof record.message === 'string' ? record.message : `请求失败（${response.status}）`,
      record.details,
    );
  }

  return {
    async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
      const response = await send(path, init);
      if (!response.ok) throw await readError(response);
      if (response.status === 204) return undefined as T;
      const payload: unknown = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object') {
        throw new ApiError(502, 'INVALID_RESPONSE', '服务器返回了无效响应');
      }
      return payload as T;
    },

    async blob(path: string, init: Omit<ApiRequestInit, 'body'> = {}): Promise<Blob> {
      const response = await send(path, { ...init, body: undefined });
      if (!response.ok) throw await readError(response);
      return response.blob();
    },
  };
}
