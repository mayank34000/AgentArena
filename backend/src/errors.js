export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DATABASE_UNAVAILABLE_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);
const DATABASE_UNAVAILABLE_MESSAGES = new Set([
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
]);

export function errorHandler(error, request, response, _next) {
  if (response.headersSent) return;

  if (error?.type === "entity.too.large") {
    return sendError(response, request, 413, "request_too_large", "The request is too large.");
  }
  if (error?.type === "entity.parse.failed" || (error instanceof SyntaxError && error.status === 400)) {
    return sendError(response, request, 400, "invalid_json", "The request body is not valid JSON.");
  }
  if (error instanceof ApiError) {
    return sendError(response, request, error.status, error.code, error.message, error.details);
  }
  if (error?.code === "23505") {
    return sendError(response, request, 409, "duplicate_resource", "A resource with those values already exists.");
  }

  if (isDatabaseUnavailable(error)) {
    return sendError(response, request, 503, "service_unavailable", "The service is temporarily unavailable.");
  }

  // Unexpected errors may contain SQL, connection details, or credentials.
  return sendError(response, request, 500, "internal_error", "An internal error occurred.");
}

function isDatabaseUnavailable(error) {
  for (let current = error; current; current = current.cause) {
    if (DATABASE_UNAVAILABLE_MESSAGES.has(current.message)) return true;
    if (typeof current.code !== "string") continue;
    if (DATABASE_UNAVAILABLE_CODES.has(current.code) || current.code.startsWith("08")) return true;
  }
  return false;
}

function sendError(response, request, status, code, message, details = []) {
  return response.status(status).json({
    error: {
      code,
      message,
      details,
      request_id: request.id,
    },
  });
}
