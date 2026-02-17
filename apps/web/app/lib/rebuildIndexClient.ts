import { parseApiError } from './apiErrors';

export type RebuildIndexResult = { ok: true } | { ok: false; message: string; code?: string };

const GENERIC_ERROR_MESSAGE = 'Could not rebuild index. Please try again.';

export async function rebuildIndex(): Promise<RebuildIndexResult> {
  try {
    const response = await fetch('/api/timeline/index/rebuild', {
      method: 'POST',
    });

    if (response.ok) {
      return { ok: true };
    }

    const parsedError = await parseApiError(response);
    if (parsedError?.message) {
      return {
        ok: false,
        message: parsedError.message,
        ...(parsedError.code ? { code: parsedError.code } : {}),
      };
    }

    return {
      ok: false,
      message: `Rebuild failed (status ${response.status}).`,
    };
  } catch {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }
}
