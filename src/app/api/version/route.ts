/**
 * GET /api/version
 *
 * Which commit this deployment was built from (Vercel sets the variable at
 * build time; local builds report null). The post-deploy workflow polls the
 * production domain until it serves the commit it was asked to check, so the
 * smoke test never runs against the previous deployment.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      ok: true,
      data: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        environment: process.env.VERCEL_ENV || "local",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
