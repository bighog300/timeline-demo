export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (init.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`) as Error & {
        status?: number;
        requestId?: string;
      };
      error.status = response.status;
      error.requestId = response.headers.get('x-request-id') ?? undefined;
      throw error;
    }
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};
