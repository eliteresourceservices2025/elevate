// A thin wrapper for the JSON endpoints. Returns the parsed body; a network failure becomes { ok: false, offline: true } so the
// screens can say "saved up to here" instead of failing silently.

export type ApiResult = { ok: boolean; error?: string; code?: string; offline?: boolean; [key: string]: unknown };

export async function post(action: string, body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as ApiResult;
    if (res.status === 401) return { ok: false, code: "signed_out", error: data.error ?? "Your session ended. Please open training from ELEVATE again." };
    return { ...data, ok: res.ok && data.ok !== false };
  } catch {
    return { ok: false, offline: true, error: "You seem to be offline. Your progress is saved up to here." };
  }
}

export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
