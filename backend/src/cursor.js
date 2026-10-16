import { ApiError } from "./errors.js";

export function parseLimit(value, defaultValue = 50, maxValue = 100) {
  if (value === undefined) return defaultValue;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiError(400, "invalid_pagination", "The pagination limit is invalid.");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > maxValue) {
    throw new ApiError(400, "invalid_pagination", "The pagination limit is invalid.");
  }
  return limit;
}

export function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(value, kind) {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (kind === "dataset" && typeof parsed.created_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed.created_at) &&
        Number.isFinite(Date.parse(parsed.created_at)) && isUuid(parsed.id)) return parsed;
    if (kind === "record" && Number.isSafeInteger(parsed.ordinal) &&
        parsed.ordinal >= 0 && parsed.ordinal <= 2147483647) return parsed;
  } catch {
    // Report one stable validation error for malformed cursors.
  }
  throw new ApiError(400, "invalid_pagination", "The pagination cursor is invalid.");
}

export function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
