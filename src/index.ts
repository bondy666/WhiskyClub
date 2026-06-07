import "dotenv/config";
import express from "express";
import cors from "cors";
import { poolPromise, sql } from "./db/sql";
import path from "path";
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      // replace this later with your real production frontend URL
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

const clientDistPath = path.join(__dirname, "../client/dist");

app.use(express.static(clientDistPath));

async function requireAllowedUser(req: any, res: any, next: any) {
  try {
    const principalHeader = req.headers["x-ms-client-principal"];

    if (!principalHeader) {
      return res.status(401).json({ error: "Not signed in" });
    }

    const decoded = Buffer.from(principalHeader, "base64").toString("utf8");
    const principal = JSON.parse(decoded);

    const claims = principal.claims || [];

    const emailClaim =
      claims.find((c: any) => c.typ === "preferred_username") ||
      claims.find((c: any) => c.typ === "email") ||
      claims.find((c: any) => c.typ === "upn");

    const email = emailClaim?.val?.toLowerCase();

    if (!email) {
      return res.status(403).json({ error: "No email claim found" });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Email", sql.NVarChar(255), email)
      .query(`
        SELECT Id, Email
        FROM AllowedUsers
        WHERE LOWER(Email) = @Email
          AND IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(403).json({
        error: "Access denied",
        email
      });
    }

    req.userEmail = email;
    next();
  } catch (error: any) {
    res.status(500).json({
      error: "Authorization check failed",
      details: error.message
    });
  }
}


const port = process.env.PORT || 3000;


app.post("/api/tasting-entries", async (req, res) => {
  try {
    const {
          tastingSessionId,
          clubMemberId,
          whiskyId,
          noseNotes,
          palateNotes,
          finishNotes,
          noseScore,
          palateScore,
          finishScore,
          overallScore
        } = req.body;

    if (!tastingSessionId || !whiskyId) {
      return res.status(400).json({
        error: "tastingSessionId and whiskyId are required"
      });
    }

    const pool = await poolPromise;

    const result = await pool.request()
  .input("TastingSessionId", sql.Int, tastingSessionId)
  .input("ClubMemberId", sql.Int, clubMemberId || null)
  .input("WhiskyId", sql.Int, whiskyId)
  .input("NoseNotes", sql.NVarChar(sql.MAX), noseNotes || null)
  .input("PalateNotes", sql.NVarChar(sql.MAX), palateNotes || null)
  .input("FinishNotes", sql.NVarChar(sql.MAX), finishNotes || null)
  .input("NoseScore", sql.Decimal(3, 1), noseScore || null)
  .input("PalateScore", sql.Decimal(3, 1), palateScore || null)
  .input("FinishScore", sql.Decimal(3, 1), finishScore || null)
  .input("OverallScore", sql.Decimal(3, 1), overallScore || null)
  .query(`
    INSERT INTO TastingEntries
      (
        TastingSessionId,
        ClubMemberId,
        WhiskyId,
        NoseNotes,
        PalateNotes,
        FinishNotes,
        NoseScore,
        PalateScore,
        FinishScore,
        OverallScore
      )
    OUTPUT INSERTED.*
    VALUES
      (
        @TastingSessionId,
        @ClubMemberId,
        @WhiskyId,
        @NoseNotes,
        @PalateNotes,
        @FinishNotes,
        @NoseScore,
        @PalateScore,
        @FinishScore,
        @OverallScore
      )
  `);

    res.status(201).json(result.recordset[0]);
  } catch (error: any) {
    console.error("Failed to create tasting entry", error);
    res.status(500).json({
      error: "Failed to create tasting entry",
      details: error.message
    });
  }
});

app.get("/api/sessions/:id/tasting-entries", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);

    const pool = await poolPromise;

    const result = await pool.request()
  .input("TastingSessionId", sql.Int, sessionId)
  .query(`
    SELECT
      te.Id,
      te.TastingSessionId,
      te.WhiskyId,
      te.ClubMemberId,
      cm.Name AS MemberName,
      w.Name AS WhiskyName,
      te.NoseNotes,
      te.PalateNotes,
      te.FinishNotes,
      te.NoseScore,
      te.PalateScore,
      te.FinishScore,
      te.OverallScore,
      te.CreatedAt
    FROM TastingEntries te
    INNER JOIN Whiskies w ON te.WhiskyId = w.Id
    LEFT JOIN ClubMembers cm ON te.ClubMemberId = cm.Id
    WHERE te.TastingSessionId = @TastingSessionId
    ORDER BY te.CreatedAt DESC
  `);

    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to retrieve tasting entries",
      details: error.message
    });
  }
});

app.get("/api/debug/sessions", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        DB_NAME() AS DatabaseName,
        COUNT(*) AS SessionCount
      FROM TastingSessions
    `);

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Debug failed",
      details: error.message
    });
  }
});

app.get("/api/sessions/:id/summary", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);

    const pool = await poolPromise;

    const result = await pool.request()
      .input("SessionId", sql.Int, sessionId)
      .query(`
        SELECT
          w.Name AS WhiskyName,
          AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScore,
          COUNT(*) AS EntryCount
        FROM TastingEntries te
        INNER JOIN Whiskies w
          ON te.WhiskyId = w.Id
        WHERE te.TastingSessionId = @SessionId
          AND te.OverallScore IS NOT NULL
        GROUP BY w.Name
        ORDER BY AverageScore DESC
      `);

    res.json(result.recordset);
  } catch (error: any) {
    console.error("Failed to retrieve session summary", error);
    res.status(500).json({
      error: "Failed to retrieve session summary",
      details: error.message
    });
  }
});



app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);

    const pool = await poolPromise;

    await pool.request()
      .input("TastingSessionId", sql.Int, sessionId)
      .query(`
        DELETE FROM TastingEntries
        WHERE TastingSessionId = @TastingSessionId
      `);

    const result = await pool.request()
      .input("Id", sql.Int, sessionId)
      .query(`
        DELETE FROM TastingSessions
        OUTPUT DELETED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({ message: "Session deleted" });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete session",
      details: error.message
    });
  }
});



app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "Whisky Club API"
  });
});

if (process.env.NODE_ENV === "production") {
  app.use("/api", requireAllowedUser);
}

app.get("/api/sessions", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT TOP 100 *
      FROM TastingSessions
      ORDER BY Id DESC
    `);

    res.json(result.recordset);
  } catch (error: any) {
    console.error("Failed to retrieve sessions", error);
    res.status(500).json({
      error: "Failed to retrieve sessions",
      details: error.message
    });
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
  } catch (error: any) {
    console.error("Failed to create session", error);
    res.status(500).json({
      error: "Failed to create session",
      details: error.message
    });
  }
});

app.get("/api/whiskies", async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT Id, Name, Distillery, Region, AgeYears, ABV, Price, ImageUrl, CreatedAt
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
    const { name, distillery, region, ageYears, abv, price, imageUrl } = req.body;

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
      .input("ImageUrl", sql.NVarChar(1000), imageUrl || null)
      .query(`
        INSERT INTO Whiskies (Name, Distillery, Region, AgeYears, ABV, Price, ImageUrl)
        OUTPUT INSERTED.*
        VALUES (@Name, @Distillery, @Region, @AgeYears, @ABV, @Price, @ImageUrl)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create whisky" });
  }
});

app.delete("/api/whiskies/:id", async (req, res) => {
  try {
    const whiskyId = Number(req.params.id);

    const pool = await poolPromise;

    await pool.request()
      .input("WhiskyId", sql.Int, whiskyId)
      .query(`
        DELETE FROM TastingEntries
        WHERE WhiskyId = @WhiskyId
      `);

    const result = await pool.request()
      .input("Id", sql.Int, whiskyId)
      .query(`
        DELETE FROM Whiskies
        OUTPUT DELETED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Whisky not found" });
    }

    res.json({ message: "Whisky deleted" });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete whisky",
      details: error.message
    });
  }
});

app.put("/api/sessions/:id", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);

    const {
      name,
      sessionDate,
      theme,
      status
    } = req.body;

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, sessionId)
      .input("Name", sql.NVarChar(100), name)
      .input("SessionDate", sql.Date, sessionDate)
      .input("Theme", sql.NVarChar(200), theme || null)
      .input("Status", sql.NVarChar(20), status)
      .query(`
        UPDATE TastingSessions
        SET
          Name = @Name,
          SessionDate = @SessionDate,
          Theme = @Theme,
          Status = @Status
        OUTPUT INSERTED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: "Session not found"
      });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to update session",
      details: error.message
    });
  }
});

app.delete("/api/tasting-entries/:id", async (req, res) => {
  try {
    const entryId = Number(req.params.id);

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, entryId)
      .query(`
        DELETE FROM TastingEntries
        OUTPUT DELETED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Tasting entry not found" });
    }

    res.json({ message: "Tasting entry deleted" });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete tasting entry",
      details: error.message
    });
  }
});

app.put("/api/tasting-entries/:id", async (req, res) => {
  try {
    const entryId = Number(req.params.id);

    const {
        clubMemberId,
        noseNotes,
        palateNotes,
        finishNotes,
        noseScore,
        palateScore,
        finishScore,
        overallScore
      } = req.body;

    const pool = await poolPromise;

    const result = await pool.request()
  .input("Id", sql.Int, entryId)
  .input("ClubMemberId", sql.Int, clubMemberId || null)
  .input("NoseNotes", sql.NVarChar(sql.MAX), noseNotes || null)
  .input("PalateNotes", sql.NVarChar(sql.MAX), palateNotes || null)
  .input("FinishNotes", sql.NVarChar(sql.MAX), finishNotes || null)
  .input("NoseScore", sql.Decimal(3, 1), noseScore || null)
  .input("PalateScore", sql.Decimal(3, 1), palateScore || null)
  .input("FinishScore", sql.Decimal(3, 1), finishScore || null)
  .input("OverallScore", sql.Decimal(3, 1), overallScore || null)
  .query(`
    UPDATE TastingEntries
    SET
      ClubMemberId = @ClubMemberId,
      NoseNotes = @NoseNotes,
      PalateNotes = @PalateNotes,
      FinishNotes = @FinishNotes,
      NoseScore = @NoseScore,
      PalateScore = @PalateScore,
      FinishScore = @FinishScore,
      OverallScore = @OverallScore
    OUTPUT INSERTED.*
    WHERE Id = @Id
  `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: "Tasting entry not found"
      });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to update tasting entry",
      details: error.message
    });
  }
});

app.get("/api/whiskies/:id/stats", async (req, res) => {
  try {
    const whiskyId = Number(req.params.id);

    const pool = await poolPromise;

    const result = await pool.request()
      .input("WhiskyId", sql.Int, whiskyId)
      .query(`
        SELECT
          w.Id,
          w.Name,
          w.Distillery,
          w.Region,
          COUNT(te.Id) AS TimesTasted,
          AVG(CAST(te.OverallScore AS FLOAT)) AS AverageOverallScore,
          MAX(te.OverallScore) AS BestScore,
          MIN(te.OverallScore) AS WorstScore
        FROM Whiskies w
        LEFT JOIN TastingEntries te
          ON w.Id = te.WhiskyId
        WHERE w.Id = @WhiskyId
        GROUP BY
          w.Id,
          w.Name,
          w.Distillery,
          w.Region
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Whisky not found" });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to retrieve whisky stats",
      details: error.message
    });
  }
});

app.put("/api/whiskies/:id", async (req, res) => {
  try {
    const whiskyId = Number(req.params.id);
    const { name, distillery, region, ageYears, abv, price, imageUrl } = req.body;

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, whiskyId)
      .input("Name", sql.NVarChar(150), name)
      .input("Distillery", sql.NVarChar(150), distillery || null)
      .input("Region", sql.NVarChar(100), region || null)
      .input("AgeYears", sql.Int, ageYears || null)
      .input("ABV", sql.Decimal(5, 2), abv || null)
      .input("Price", sql.Decimal(10, 2), price || null)
      .input("ImageUrl", sql.NVarChar(1000), imageUrl || null)
      .query(`
  UPDATE Whiskies
  SET
    Name = @Name,
    Distillery = @Distillery,
    Region = @Region,
    AgeYears = @AgeYears,
    ABV = @ABV,
    Price = @Price,
    ImageUrl = @ImageUrl
  OUTPUT INSERTED.*
  WHERE Id = @Id
`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Whisky not found" });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to update whisky",
      details: error.message
    });
  }
});
app.get("/api/dashboard", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM TastingSessions) AS SessionCount,
        (SELECT COUNT(*) FROM Whiskies) AS WhiskyCount,
        (SELECT COUNT(*) FROM TastingEntries) AS TastingEntryCount,
        (SELECT COUNT(*) FROM ClubMembers WHERE IsActive = 1) AS ActiveMemberCount,
        (SELECT AVG(CAST(OverallScore AS FLOAT)) FROM TastingEntries WHERE OverallScore IS NOT NULL) AS AverageOverallScore
    `);

    const topWhisky = await pool.request().query(`
      SELECT TOP 1
        w.Name AS WhiskyName,
        AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScore
      FROM TastingEntries te
      INNER JOIN Whiskies w ON te.WhiskyId = w.Id
      WHERE te.OverallScore IS NOT NULL
      GROUP BY w.Name
      ORDER BY AverageScore DESC
    `);

    const mostActiveMember = await pool.request().query(`
      SELECT TOP 1
        cm.Name AS MemberName,
        COUNT(te.Id) AS TastingCount
      FROM TastingEntries te
      INNER JOIN ClubMembers cm ON te.ClubMemberId = cm.Id
      GROUP BY cm.Name
      ORDER BY TastingCount DESC
    `);

    const recentSessions = await pool.request().query(`
      SELECT TOP 5
        Id,
        Name,
        SessionDate,
        Theme,
        Status
      FROM TastingSessions
      ORDER BY SessionDate DESC
    `);

    res.json({
      ...counts.recordset[0],
      TopWhisky: topWhisky.recordset[0] || null,
      MostActiveMember: mostActiveMember.recordset[0] || null,
      RecentSessions: recentSessions.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to load dashboard",
      details: error.message
    });
  }
});

app.get("/api/members", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT Id, Name, Email, IsActive, CreatedAt
      FROM ClubMembers
      ORDER BY Name
    `);

    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to retrieve members",
      details: error.message
    });
  }
});

app.post("/api/members", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Name", sql.NVarChar(100), name)
      .input("Email", sql.NVarChar(255), email || null)
      .query(`
        INSERT INTO ClubMembers (Name, Email)
        OUTPUT INSERTED.*
        VALUES (@Name, @Email)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to create member",
      details: error.message
    });
  }
});

app.put("/api/members/:id", async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    const { name, email, isActive } = req.body;

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, memberId)
      .input("Name", sql.NVarChar(100), name)
      .input("Email", sql.NVarChar(255), email || null)
      .input("IsActive", sql.Bit, isActive ?? true)
      .query(`
        UPDATE ClubMembers
        SET
          Name = @Name,
          Email = @Email,
          IsActive = @IsActive
        OUTPUT INSERTED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to update member",
      details: error.message
    });
  }
});

app.delete("/api/members/:id", async (req, res) => {
  try {
    const memberId = Number(req.params.id);

    const pool = await poolPromise;

    const linkedEntries = await pool.request()
      .input("ClubMemberId", sql.Int, memberId)
      .query(`
        SELECT COUNT(*) AS EntryCount
        FROM TastingEntries
        WHERE ClubMemberId = @ClubMemberId
      `);

    if (linkedEntries.recordset[0].EntryCount > 0) {
      return res.status(400).json({
        error: "Cannot delete member with tasting entries. Set them inactive instead."
      });
    }

    const result = await pool.request()
      .input("Id", sql.Int, memberId)
      .query(`
        DELETE FROM ClubMembers
        OUTPUT DELETED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    res.json({ message: "Member deleted" });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete member",
      details: error.message
    });
  }
});

app.get("/api/members/:id/stats", async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    const pool = await poolPromise;

    const result = await pool.request()
      .input("MemberId", sql.Int, memberId)
      .query(`
        SELECT
          cm.Id,
          cm.Name,
          cm.Email,
          cm.IsActive,
          COUNT(te.Id) AS TastingsSubmitted,
          AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScoreGiven,
          MAX(te.OverallScore) AS HighestScoreGiven,
          MIN(te.OverallScore) AS LowestScoreGiven
        FROM ClubMembers cm
        LEFT JOIN TastingEntries te
          ON cm.Id = te.ClubMemberId
        WHERE cm.Id = @MemberId
        GROUP BY
          cm.Id,
          cm.Name,
          cm.Email,
          cm.IsActive
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    const favourite = await pool.request()
      .input("MemberId", sql.Int, memberId)
      .query(`
        SELECT TOP 1
          w.Name AS WhiskyName,
          te.OverallScore
        FROM TastingEntries te
        INNER JOIN Whiskies w ON te.WhiskyId = w.Id
        WHERE te.ClubMemberId = @MemberId
          AND te.OverallScore IS NOT NULL
        ORDER BY te.OverallScore DESC, te.CreatedAt DESC
      `);

    res.json({
      ...result.recordset[0],
      FavouriteWhisky: favourite.recordset[0] || null
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to retrieve member stats",
      details: error.message
    });
  }
});

// all /api routes above here

app.use((_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Whisky Club API running on port ${port}`);
});
