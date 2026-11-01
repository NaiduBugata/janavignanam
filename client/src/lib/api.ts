import { apiUrl } from "./apiBase";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string | string[]; error?: string };
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(", ") : data.message || data.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export async function apiUpload<T>(path: string, formData: FormData, token?: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string | string[]; error?: string };
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(", ") : data.message || data.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}
