import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/version/route";

describe("GET /api/version", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the commit Vercel built, uncached", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123abcd");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { commit: "0123abcd", environment: "production" } });
  });

  it("says null outside Vercel instead of guessing", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_ENV", "");
    const body = await GET().json();
    expect(body.data.commit).toBeNull();
    expect(body.data.environment).toBe("local");
  });
});
