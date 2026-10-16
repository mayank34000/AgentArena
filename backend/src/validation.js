import { createHash } from "node:crypto";

import { ApiError } from "./errors.js";

const DATASET_FIELDS = new Set(["name", "metadata", "records"]);
const DATASET_VERSION_FIELDS = new Set(["metadata", "records"]);
const RECORD_FIELDS = new Set(["id", "input", "reference", "metadata"]);
const MODEL_FIELDS = new Set(["name", "adapter_type", "provider_id", "model_id", "endpoint", "settings", "credential_profile"]);

export function validateDatasetPayload(body, maxRecords) {
  requireObject(body, "body");
  rejectUnknownFields(body, DATASET_FIELDS, "body");
  const name = requireNonEmptyString(body.name, "name", 200);
  const metadata = optionalObject(body.metadata, "metadata");
  return { name, metadata, records: validateRecords(body.records, maxRecords) };
}

export function validateDatasetVersionPayload(body, maxRecords) {
  requireObject(body, "body");
  rejectUnknownFields(body, DATASET_VERSION_FIELDS, "body");
  const metadata = optionalObject(body.metadata, "metadata");
  return { metadata, records: validateRecords(body.records, maxRecords) };
}

function validateRecords(recordsValue, maxRecords) {
  if (!Array.isArray(recordsValue) || recordsValue.length === 0) {
    throw validationError("records", "must be a non-empty array");
  }
  if (recordsValue.length > maxRecords) {
    throw new ApiError(413, "too_many_records", "The dataset contains too many records.");
  }

  const ids = new Set();
  return recordsValue.map((record, index) => {
    const location = `records[${index}]`;
    requireObject(record, location);
    rejectUnknownFields(record, RECORD_FIELDS, location);
    const id = requireNonEmptyString(record.id, `${location}.id`, 500);
    if (ids.has(id)) throw validationError(`${location}.id`, "must be unique within the dataset");
    ids.add(id);
    const input = requireNonEmptyString(record.input, `${location}.input`, 100000);
    const reference = requireString(record.reference, `${location}.reference`, 100000);
    const recordMetadata = optionalObject(record.metadata, `${location}.metadata`);
    return { id, input, reference, metadata: recordMetadata };
  });
}

export function validateModelPayload(body) {
  requireObject(body, "body");
  rejectUnknownFields(body, MODEL_FIELDS, "body");
  const name = requireNonEmptyString(body.name, "name", 200);
  const adapterType = requireNonEmptyString(body.adapter_type, "adapter_type", 100);
  const providerId = requireNonEmptyString(body.provider_id, "provider_id", 100);
  const modelId = requireNonEmptyString(body.model_id, "model_id", 200);
  const settings = optionalObject(body.settings, "settings");

  if (adapterType !== "mock" || providerId !== "local" || modelId !== "deterministic-mock") {
    throw new ApiError(422, "unsupported_model_configuration", "Only the registered local mock configuration is supported.");
  }
  if (Object.keys(settings).length > 0) throw validationError("settings", "must be empty for the local mock adapter");
  if (body.endpoint !== undefined && body.endpoint !== null) {
    throw validationError("endpoint", "is not supported for the local mock adapter");
  }
  if (body.credential_profile !== undefined && body.credential_profile !== null) {
    throw validationError("credential_profile", "is not supported in this milestone");
  }

  return { name, adapterType, providerId, modelId, endpoint: null, settings, credentialProfile: null };
}

export function contentDigest(records) {
  const normalized = records.map(({ id, input, reference, metadata }) => ({ id, input, reference, metadata }));
  return createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requireObject(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(field, "must be an object");
  }
}

function optionalObject(value, field) {
  if (value === undefined) return {};
  requireObject(value, field);
  return value;
}

function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw validationError(field, `must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function requireString(value, field, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw validationError(field, `must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function rejectUnknownFields(value, allowed, location) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw validationError(location, `contains unsupported field '${unknown[0]}'`);
}

function validationError(field, message) {
  return new ApiError(422, "validation_error", "The request contains invalid fields.", [{ field, message }]);
}
