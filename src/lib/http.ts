/**
 * Route-handler transport helpers.
 *
 * Keeps route handlers thin: validate → call service → respond. Errors map
 * deterministically to status codes; unexpected failures get a correlation id
 * logged server-side and a generic 500 body (no internals leaked).
 */

import { AppError, isAppError, withCorrelationId } from "./errors";
import type { ZodSchema } from "zod";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    kind: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  const body: ApiSuccess<T> = { ok: true, data };
  return Response.json(body, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function jsonFail(error: unknown, fallbackStatus = 500): Response {
  if (isAppError(error)) {
    const body: ApiFailure = {
      ok: false,
      error: { kind: error.kind, message: error.message, details: error.details },
    };
    return Response.json(body, { status: error.status });
  }

  const { correlationId, toLog } = withCorrelationId(error);
  console.error("[unhandled]", JSON.stringify(toLog));
  const body: ApiFailure = {
    ok: false,
    error: {
      kind: "internal",
      message: "An internal error occurred. Reference id: " + correlationId,
      correlationId,
    },
  };
  return Response.json(body, { status: fallbackStatus });
}

/** Wrap a route handler body with uniform error translation. */
export async function handleRoute<T>(body: () => Promise<T>, init?: ResponseInit): Promise<Response> {
  try {
    return jsonOk(await body(), init);
  } catch (error) {
    return jsonFail(error);
  }
}

/** Parse + validate a URL's query parameters against a Zod schema. */
export function parseSearch<T>(params: URLSearchParams, schema: ZodSchema<T>): T {
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    raw[key] = value;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError("validation", "Invalid query parameters", {
      details: result.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/** Parse + validate a JSON request body against a Zod schema. */
export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("validation", "Request body must be valid JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError("validation", "Invalid request body", {
      details: result.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
