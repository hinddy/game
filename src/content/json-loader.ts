/** Enforce decoded byte limits while reading, including chunked responses without Content-Length. */
export async function loadJSON(
  url: string,
  signal: AbortSignal,
  maxBytes = 65536,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<unknown> {
  const response = await request(url, { signal, cache: "default" });
  if (!response.ok) throw Error("World download unavailable");
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw Error("World exceeds transfer budget");
  }
  if (!response.body) throw Error("World response is empty");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("World exceeds transfer budget");
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
