/**
 * Application error model.
 *
 * Expected failures are thrown as `AppError` with a machine-readable `kind`.
 * Route handlers translate kinds to HTTP status codes; unexpected exceptions
 * are logged with a correlation id and surfaced as generic 500s.
 */

import { randomUUID } from "node:crypto";

export type AppErrorKind =
  | "validation" // invalid user input (400)
  | "not-found" // unknown satellite id, missing resource (404)
  | "provider" // upstream data-provider failure (502)
  | "propagation" // numerical propagation failure (422)
  | "stale-data" // element data too old for the requested horizon (422 w/ retry info)
  | "persistence" // database unavailable/failure (503)
  | "conflict" // duplicate/inconsistent write (409)
  | "internal"; // unexpected (500)

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly details?: unknown;
  /** HTTP status for route handlers. */
  readonly status: number;

  constructor(kind: AppErrorKind, message: string, options?: { details?: unknown; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.kind = kind;
    this.details = options?.details;
    this.status = HTTP_STATUS[kind satisfies AppErrorKind as AppErrorKind];
  }
}

const HTTP_STATUS: Record<AppErrorKind, number> = {
  validation: 400,
  "not-found": 404,
  provider: 502,
  propagation: 422,
  "stale-data": 422,
  persistence: 503,
  conflict: 409,
  internal: 500,
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** True when the error means "we could not reach/parse the upstream provider". */
export function isProviderFailure(error: unknown): boolean {
  return isAppError(error) && error.kind === "provider";
}

/**
 * Wrap an unexpected exception with a correlation id so logs and the response
 * the user sees can be joined, without leaking internals to the client.
 */
export function withCorrelationId(error: unknown): { correlationId: string; toLog: Record<string, unknown> } {
  const correlationId = randomUUID();
  const toLog = {
    correlationId,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  return { correlationId, toLog };
}
