import "dotenv/config";
import sql from "mssql";

const connectionString = process.env.SQL_CONNECTION_STRING;

if (!connectionString) {
  throw new Error("SQL_CONNECTION_STRING is not set");
}

export const poolPromise = new sql.ConnectionPool(connectionString)
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

export const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER!,
  database: process.env.SQL_DATABASE!,
  options: {
    encrypt: true,
    trustServerCertificate: false
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000
  }
};