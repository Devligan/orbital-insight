/**
 * Who built this and where the source lives: one place, overridable per
 * deployment (NEXT_PUBLIC_* values are inlined at build time), so the credit
 * can carry a full name or a portfolio link without a code change.
 */

export const AUTHOR_NAME = process.env.NEXT_PUBLIC_AUTHOR_NAME || "Devligan";
export const AUTHOR_URL = process.env.NEXT_PUBLIC_AUTHOR_URL || "https://github.com/Devligan";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/Devligan/orbital-insight";
