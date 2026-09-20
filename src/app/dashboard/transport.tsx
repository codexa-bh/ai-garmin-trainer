export async function readResponse(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.ok ? "OK" : `HTTP ${response.status}`;
  try {
    const json = JSON.parse(text) as unknown;
    return JSON.stringify(json, null, 2);
  } catch {
    return text;
  }
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    try {
      const json = JSON.parse(text) as { error?: string };
      throw new Error(json.error ?? `HTTP ${response.status}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message !== "Unexpected end of JSON input"
      )
        throw error;
      throw new Error(text || `HTTP ${response.status}`);
    }
  }
  return JSON.parse(text) as T;
}
