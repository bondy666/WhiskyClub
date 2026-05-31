import "dotenv/config";
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

app.get("/api/whiskies", async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT Id, Name, Distillery, Region, AgeYears, ABV, Price, CreatedAt
      FROM Whiskies
      ORDER BY Name
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve whiskies" });
  }
});

app.post("/api/whiskies", async (req, res) => {
  try {
    const { name, distillery, region, ageYears, abv, price } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Name", sql.NVarChar(150), name)
      .input("Distillery", sql.NVarChar(150), distillery || null)
      .input("Region", sql.NVarChar(100), region || null)
      .input("AgeYears", sql.Int, ageYears || null)
      .input("ABV", sql.Decimal(5, 2), abv || null)
      .input("Price", sql.Decimal(10, 2), price || null)
      .query(`
        INSERT INTO Whiskies (Name, Distillery, Region, AgeYears, ABV, Price)
        OUTPUT INSERTED.*
        VALUES (@Name, @Distillery, @Region, @AgeYears, @ABV, @Price)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create whisky" });
  }
});


app.listen(port, () => {
  console.log(`Whisky Club API running on port ${port}`);
});