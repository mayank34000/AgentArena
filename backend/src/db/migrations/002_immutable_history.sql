CREATE FUNCTION reject_immutable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable history cannot be modified'
    USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

CREATE TRIGGER dataset_versions_reject_row_mutation
BEFORE UPDATE OR DELETE ON dataset_versions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_history_mutation();

CREATE TRIGGER dataset_versions_reject_truncate
BEFORE TRUNCATE ON dataset_versions
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_history_mutation();

CREATE TRIGGER dataset_records_reject_row_mutation
BEFORE UPDATE OR DELETE ON dataset_records
FOR EACH ROW EXECUTE FUNCTION reject_immutable_history_mutation();

CREATE TRIGGER dataset_records_reject_truncate
BEFORE TRUNCATE ON dataset_records
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_history_mutation();

CREATE TRIGGER model_configurations_reject_row_mutation
BEFORE UPDATE OR DELETE ON model_configurations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_history_mutation();

CREATE TRIGGER model_configurations_reject_truncate
BEFORE TRUNCATE ON model_configurations
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_history_mutation();
