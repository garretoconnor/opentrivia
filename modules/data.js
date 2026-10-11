export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(body.error || `Request failed (${response.status}).`);
    requestError.status = response.status;
    throw requestError;
  }
  return body;
}

export function allowsLocalFallback(error) {
  return error instanceof TypeError || [404, 501, 503].includes(error?.status);
}
