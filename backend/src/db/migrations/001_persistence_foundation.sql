CREATE TABLE users (
  id uuid PRIMARY KEY,
  issuer text NOT NULL CHECK (length(btrim(issuer)) > 0),
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE datasets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  latest_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE dataset_versions (
  id uuid PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  version integer NOT NULL CHECK (version > 0),
  format_version text NOT NULL CHECK (length(btrim(format_version)) > 0),
  record_count integer NOT NULL CHECK (record_count > 0),
  content_digest char(64) NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version),
  UNIQUE (dataset_id, id)
);

ALTER TABLE datasets
  ADD CONSTRAINT datasets_latest_version_fk
  FOREIGN KEY (id, latest_version_id)
  REFERENCES dataset_versions (dataset_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE dataset_records (
  id uuid PRIMARY KEY,
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  example_id text NOT NULL CHECK (length(btrim(example_id)) > 0),
  input text NOT NULL CHECK (length(btrim(input)) > 0),
  reference text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (dataset_version_id, ordinal),
  UNIQUE (dataset_version_id, example_id)
);

CREATE TABLE model_configurations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  adapter_type text NOT NULL CHECK (length(btrim(adapter_type)) > 0),
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) > 0),
  model_id text NOT NULL CHECK (length(btrim(model_id)) > 0),
  endpoint text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  credential_profile text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX datasets_owner_created_idx ON datasets (owner_id, created_at DESC, id DESC);
CREATE INDEX model_configurations_owner_created_idx ON model_configurations (owner_id, created_at DESC, id DESC);
