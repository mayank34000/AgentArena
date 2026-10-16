const DEV_ISSUER = "urn:agent-arena:development";

export function createIdentityResolver(env = process.env) {
  if (env.DEV_AUTH_ENABLED === "true" && env.NODE_ENV !== "development") {
    throw new Error("DEV_AUTH_ENABLED is permitted only when NODE_ENV=development");
  }

  if (env.NODE_ENV === "development" && env.DEV_AUTH_ENABLED === "true") {
    const allowedSubjects = new Set(
      (env.DEV_AUTH_USERS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (allowedSubjects.size === 0) {
      throw new Error("DEV_AUTH_USERS must list allowed development identities");
    }

    return (request) => {
      const subject = request.get("x-dev-user");
      if (!subject || !allowedSubjects.has(subject)) return null;
      return { issuer: DEV_ISSUER, subject };
    };
  }

  // Authentication is not implemented yet. Production and unconfigured development fail closed.
  return () => null;
}

export function isValidIdentity(identity) {
  return (
    identity !== null &&
    typeof identity === "object" &&
    typeof identity.issuer === "string" &&
    identity.issuer.trim().length > 0 &&
    identity.issuer.length <= 255 &&
    typeof identity.subject === "string" &&
    identity.subject.trim().length > 0 &&
    identity.subject.length <= 255
  );
}
