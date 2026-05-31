import express from "express";
import { poolPromise, sql } from "./db/sql";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Whisky Club API is running");
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "Whisky Club API"
  });
});

app.get("/api/sessions", async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT Id, Name, SessionDate, Theme, Status, CreatedAt
      FROM TastingSessions
      ORDER BY SessionDate DESC
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve sessions" });
  }
});

app.post("/api/sessions", async (req, res) => {
  try {
    const { name, sessionDate, theme, status } = req.body;

    if (!name || !sessionDate) {
      return res.status(400).json({
        error: "name and sessionDate are required"
      });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Name", sql.NVarChar(100), name)
      .input("SessionDate", sql.Date, sessionDate)
      .input("Theme", sql.NVarChar(200), theme || null)
      .input("Status", sql.NVarChar(20), status || "planned")
      .query(`
        INSERT INTO TastingSessions (Name, SessionDate, Theme, Status)
        OUTPUT INSERTED.*
        VALUES (@Name, @SessionDate, @Theme, @Status)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create session" });
  }
});

app.listen(port, () => {
  console.log(`Whisky Club API running on port ${port}`);
});