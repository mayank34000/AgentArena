class ModelAdapterError(Exception):
    """A safe-to-report failure translated by an adapter from provider details."""


class DatasetValidationError(ValueError):
    """An evaluation dataset does not match the supported example format."""


class SchemaValidationError(ValueError):
    """A supplied schema is invalid or outside the supported JSON Schema draft."""
