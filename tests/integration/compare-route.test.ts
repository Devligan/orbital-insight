/**
 * GET /api/compare, called directly with the analysis service stubbed: the
 * request boundary only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const compareElementSets = vi.fn();
vi.mock("@/server/analysis", () => ({ compareElementSets }));

const { GET } = await import("@/app/api/compare/route");

async function get(query: string): Promise<{ status: number; message?: string }> {
  const response = await GET(new Request(`http://local/api/compare?${query}`));
  const body = (await response.json()) as { error?: { message: string } };
  return { status: response.status, message: body.error?.message };
}

beforeEach(() => {
  compareElementSets.mockReset();
  compareElementSets.mockResolvedValue({ left: {}, right: {}, positionDeltas: [], notes: [] });
});

describe("GET /api/compare", () => {
  it("names the side that's wrong", async () => {
    const { status, message } = await get("left=25544&right=999999999");
    expect(status).toBe(400);
    expect(message).toBe("Invalid comparison request. Right catalog ID must be a number from 1 to 99999.");
    expect(compareElementSets).not.toHaveBeenCalled();
  });

  it("names both sides when both are wrong", async () => {
    const { message } = await get("left=abc&right=0");
    expect(message).toContain("Left catalog ID must be");
    expect(message).toContain("Right catalog ID must be");
  });

  it("accepts any spelling and compares the padded numbers", async () => {
    const { status } = await get("left=00025544&right=5");
    expect(status).toBe(200);
    expect(compareElementSets).toHaveBeenCalledWith(expect.objectContaining({ left: "25544", right: "00005" }));
  });
});
