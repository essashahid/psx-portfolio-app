import { supabase } from "./supabase";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

if (!BASE_URL) {
  throw new Error(
    "Missing EXPO_PUBLIC_API_URL. Copy mobile/.env.example to mobile/.env and point it at the deployed app, or at your machine's LAN address when running next dev."
  );
}

/**
 * An error the caller can show. The API returns { error } for anything a user
 * can act on and a generic message otherwise, so the text here is already safe
 * to display.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Not JSON. Fall through to the status text.
  }
  return response.status >= 500
    ? "Something went wrong. Please try again."
    : `Request failed (${response.status})`;
}

/**
 * Calls the same Next API routes the web app uses, authenticating with the
 * Supabase access token instead of session cookies. requireUser() on the server
 * accepts either.
 *
 * A 401 is retried exactly once behind a forced refresh: the common cause is an
 * access token that expired while the app was backgrounded, and the refresh
 * token is usually still good. A second 401 is a real sign out.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${BASE_URL}${path}`, { ...init, headers });
  };

  let response = await send(await accessToken());

  if (response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      response = await send(data.session.access_token);
    }
  }

  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const apiUrl = (path: string) => `${BASE_URL}${path}`;

/** The header the chat stream needs, since it does not go through api(). */
export async function authHeader(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
