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