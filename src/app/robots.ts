import type { MetadataRoute } from "next";

const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    // Pages are for people; the APIs proxy a free public provider and shouldn't be crawled.
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    ...(host ? { sitemap: `https://${host}/sitemap.xml` } : {}),
  };
}
