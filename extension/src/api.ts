export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function request(api: string, path: string, token?: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${api}${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "omit",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError("CP Notes could not be reached. Your draft is kept. Check the diary before retrying a save.", 0);
    }
    if (response.status === 204) return undefined;
    if (response.status === 401) throw new ApiError(path.includes("login") ? "Email or password is incorrect." : "Your session ended. Sign in again to recover your draft.", 401);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new ApiError("CP Notes is temporarily unavailable. Your draft is kept. Check the diary before retrying a save.", response.status); }
    if (!response.ok) {
      if (payload && typeof payload === "object" && "error" in payload && payload.error && typeof payload.error === "object" && "message" in payload.error && typeof payload.error.message === "string") {
        throw new ApiError(payload.error.message, response.status);
      }
      throw new ApiError("The request failed. Your draft is kept.", response.status);
    }
    if (!payload || typeof payload !== "object" || !("data" in payload)) throw new ApiError("CP Notes returned an unreadable response. Check the diary before retrying.", response.status);
    return payload.data;
  } finally { clearTimeout(timer); }
}
