import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SfuError, callsConfigured, closeTracks, createSession, iceServers, pullTracks, pushTracks, renegotiate } from "./sfu";

const APP = "a".repeat(32);
const SESSION = "b".repeat(32);
const OTHER = "c".repeat(32);
const SECRET = "app-secret-value";
const calls: { url: string; init: RequestInit }[] = [];

function reply(body: unknown, status = 200) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("CLOUDFLARE_REALTIME_APP_ID", APP);
  vi.stubEnv("CLOUDFLARE_REALTIME_APP_SECRET", SECRET);
  vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", "turn-key-1234");
  vi.stubEnv("CLOUDFLARE_TURN_KEY_TOKEN", "turn-token-value");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("is on only when all four settings exist", () => {
    expect(callsConfigured()).toBe(true);
    for (const name of ["CLOUDFLARE_REALTIME_APP_ID", "CLOUDFLARE_REALTIME_APP_SECRET", "CLOUDFLARE_TURN_KEY_ID", "CLOUDFLARE_TURN_KEY_TOKEN"]) {
      vi.stubEnv(name, "");
      expect(callsConfigured(), name).toBe(false);
      vi.unstubAllEnvs();
      vi.stubEnv("CLOUDFLARE_REALTIME_APP_ID", APP);
      vi.stubEnv("CLOUDFLARE_REALTIME_APP_SECRET", SECRET);
      vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", "turn-key-1234");
      vi.stubEnv("CLOUDFLARE_TURN_KEY_TOKEN", "turn-token-value");
    }
  });
  it("refuses a malformed app id", () => {
    vi.stubEnv("CLOUDFLARE_REALTIME_APP_ID", "../evil");
    expect(callsConfigured()).toBe(false);
  });
});

describe("sessions and tracks", () => {
  it("creates a session with the bearer secret, no redirects, and returns only a valid id", async () => {
    vi.stubGlobal("fetch", reply({ sessionId: SESSION }));
    expect(await createSession()).toEqual({ sessionId: SESSION });
    expect(calls[0].url).toBe(`https://rtc.live.cloudflare.com/v1/apps/${APP}/sessions/new`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0].init.redirect).toBe("error");
  });

  it("refuses a session id that is not 32 hex characters from Cloudflare", async () => {
    vi.stubGlobal("fetch", reply({ sessionId: "../../x" }));
    await expect(createSession()).rejects.toMatchObject({ status: 502 });
  });

  it("pushes local tracks with the person's offer", async () => {
    vi.stubGlobal("fetch", reply({ sessionDescription: { type: "answer", sdp: "v=0" }, tracks: [{ mid: "0", trackName: "audio-1" }] }));
    const out = await pushTracks(SESSION, { type: "offer", sdp: "v=0 offer" }, [{ mid: "0", trackName: "audio-1" }]);
    expect(out.sessionDescription?.type).toBe("answer");
    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe(`https://rtc.live.cloudflare.com/v1/apps/${APP}/sessions/${SESSION}/tracks/new`);
    expect(body.tracks).toEqual([{ location: "local", mid: "0", trackName: "audio-1" }]);
    expect(body.sessionDescription.sdp).toBe("v=0 offer");
  });

  it("pulls remote tracks by publisher session and track name", async () => {
    vi.stubGlobal("fetch", reply({ sessionDescription: { type: "offer", sdp: "v=0" }, requiresImmediateRenegotiation: true, tracks: [{ mid: "1", trackName: "video-1" }] }));
    const out = await pullTracks(SESSION, [{ sessionId: OTHER, trackName: "video-1" }]);
    expect(out.requiresImmediateRenegotiation).toBe(true);
    expect(JSON.parse(String(calls[0].init.body)).tracks).toEqual([{ location: "remote", sessionId: OTHER, trackName: "video-1" }]);
  });

  it("renegotiates with an answer only, and closes tracks by mid", async () => {
    vi.stubGlobal("fetch", reply({}));
    await renegotiate(SESSION, { type: "answer", sdp: "v=0" });
    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].url.endsWith(`/sessions/${SESSION}/renegotiate`)).toBe(true);
    await closeTracks(SESSION, ["0", "1"]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ tracks: [{ mid: "0" }, { mid: "1" }], force: true });
    await expect(renegotiate(SESSION, { type: "offer", sdp: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("never builds a request from ids or names that are not plain tokens", async () => {
    const fetchMock = reply({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(pushTracks("../../etc", { type: "offer", sdp: "x" }, [{ mid: "0", trackName: "a" }])).rejects.toBeInstanceOf(SfuError);
    await expect(pushTracks(SESSION, { type: "offer", sdp: "x" }, [{ mid: "0", trackName: "a/b" }])).rejects.toBeInstanceOf(SfuError);
    await expect(pushTracks(SESSION, { type: "offer", sdp: "x" }, [])).rejects.toBeInstanceOf(SfuError);
    await expect(pullTracks(SESSION, [{ sessionId: "not-hex", trackName: "a" }])).rejects.toBeInstanceOf(SfuError);
    await expect(closeTracks(SESSION, ["0 ; drop"])).rejects.toBeInstanceOf(SfuError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a Cloudflare error into a status-only error (no body, no secret)", async () => {
    vi.stubGlobal("fetch", reply({ error: `leaked ${SECRET}` }, 500));
    const error = await createSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SfuError);
    expect((error as SfuError).status).toBe(500);
    expect(String((error as SfuError).message)).not.toContain(SECRET);
  });
});

describe("TURN credentials", () => {
  it("mints with the TURN token, clamps the lifetime, and passes on only stun and turn addresses", async () => {
    vi.stubGlobal(
      "fetch",
      reply({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp", "javascript:alert(1)", "https://x"], username: "u", credential: "c" }] }),
    );
    const servers = await iceServers(10);
    expect(calls[0].url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-1234/credentials/generate-ice-servers");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer turn-token-value");
    expect(JSON.parse(String(calls[0].init.body)).ttl).toBe(600);
    expect(servers).toEqual([{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }]);
  });

  it("accepts a single object answer too", async () => {
    vi.stubGlobal("fetch", reply({ iceServers: { urls: "turns:turn.cloudflare.com:443", username: "u", credential: "c" } }));
    expect((await iceServers())[0].urls).toEqual(["turns:turn.cloudflare.com:443"]);
  });
});
