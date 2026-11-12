import type { MetadataRoute } from "next";

const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const base = host ? `https://${host}` : "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/atlas", "/conjunctions", "/passes", "/compare", "/methodology"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "/methodology" ? "monthly" : "daily",
  }));
}
