
export async function getApiHealth(signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/health', {
    method: 'GET',
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API health check failed: ${response.status}`);
  }

  const data: { status?: string } = await response.json();

  if (data.status !== 'ok') {
    throw new Error('API returned an unexpected health status');
  }
}
