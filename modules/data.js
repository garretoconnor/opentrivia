import { state } from './state.js?v=0.10.1';
export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "x-opentrivia-account": state.account?.id || "guest", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error((typeof body.error === "string" ? body.error : body.message) || `Request failed (${response.status}).`);
    requestError.status = response.status;
    throw requestError;
  }
  return body;
}

export function allowsLocalFallback(error) {
  return error instanceof TypeError || [404, 501, 503].includes(error?.status);
}
