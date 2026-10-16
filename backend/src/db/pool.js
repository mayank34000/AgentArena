import pg from "pg";

export function createPool(config) {
  return new pg.Pool(config.database);
}
