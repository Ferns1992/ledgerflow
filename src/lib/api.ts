export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiOptions {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Invoked when any request comes back 401 so the shell can drop the session.
 * Kept as a hook rather than an import cycle so api.ts stays dependency-free.
 */
let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

const MUTATING: Method[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (MUTATING.includes(method)) {
    // SameSite=Lax already blocks cross-site form posts; this header additionally
    // blocks anything a hostile page might try to send as a simple request.
    headers['X-Requested-With'] = 'ledgerflow';
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    // The session lives in an HttpOnly cookie, so it rides along automatically.
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') unauthorizedHandler?.();
    throw new ApiError(res.status, payload?.error ?? `Request failed (${res.status})`, payload ?? {});
  }

  return payload as T;
}

/** Convenience wrapper so callers can read a typed field off the error payload. */
export function field<T = unknown>(error: unknown, key: string): T | undefined {
  if (error instanceof ApiError) return error.payload[key] as T | undefined;
  return undefined;
}

/**
 * Turns anything thrown by `api()` into a message worth showing a user.
 * Network failures get their own wording because "Failed to fetch" means
 * something very different from a rejected validation.
 */
export function errMsg(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof TypeError) return 'Cannot reach the server. Check your connection.';
  return fallback;
}
