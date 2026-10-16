// Fetch wrapper: JSON, timeouts, CSRF header for signed-in mutations, friendly errors.

let csrfToken = null;
export const setCsrf = (token) => { csrfToken = token || null; };

export class ApiError extends Error {
  constructor(message, status = 0, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function api(path, { method = "GET", body, timeoutMs = 30000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let res;
  try {
    res = await fetch(path, {
      method, headers, credentials: "same-origin", signal: ctrl.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new ApiError(signal?.aborted ? "Cancelled." : "This is taking longer than usual. Please try again.", 0);
    throw new ApiError(navigator.onLine === false ? "You're offline. Check your connection and try again." : "Can't reach Recipe Bot right now. Please try again.", 0);
  }
  clearTimeout(timer);
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    let message = data && typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.";
    if (res.status === 422 && data?.errors?.length) {
      message = data.errors.map((e) => (e.field && e.field !== "body" ? `${prettyField(e.field)}: ` : "") + e.message.replace(/^Value error, /, "")).join(" · ");
    }
    throw new ApiError(message, res.status, Number(res.headers.get("Retry-After")) || null);
  }
  return data;
}

function prettyField(field) {
  return field.replace(/\.\d+$/, "").replace(/_/g, " ").replace(/\./g, " › ");
}
