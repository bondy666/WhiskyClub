import "dotenv/config";
import sql from "mssql";

const connectionString = process.env.SQL_CONNECTION_STRING;

if (!connectionString) {
  throw new Error("SQL_CONNECTION_STRING is not set");
}

// Build the pool from the connection string, then cap the pool size for the
// Azure SQL Basic tier (max ~30 concurrent sessions). Keeping max low leaves
// headroom if more than one app instance ever connects.
const poolConfig = sql.ConnectionPool.parseConnectionString(connectionString);
poolConfig.pool = {
  ...poolConfig.pool,
  max: 8,
  min: 1,
  idleTimeoutMillis: 30000
};

export const poolPromise = new sql.ConnectionPool(poolConfig)
  .connect()
  .then(pool => {
    console.log("Connected to Azure SQL");
    return pool;
  })
  .catch(err => {
    console.error("SQL connection failed", err);
    throw err;
  });

export { sql };