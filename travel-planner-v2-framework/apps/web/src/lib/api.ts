import type { ApiHealth } from '@travel/shared';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const response = await fetch(`${apiBase}/health`, { signal });
  if (!response.ok) throw new Error('API unavailable');
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('status' in data) ||
    !('service' in data) ||
    data.status !== 'ok' ||
    data.service !== 'travel-planner-api'
  ) {
    throw new Error('Invalid API health response');
  }
  return { status: data.status, service: data.service };
}
