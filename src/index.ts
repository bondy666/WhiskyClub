import "dotenv/config";
import express from "express";
import cors from "cors";
import { poolPromise, sql } from "./db/sql";
import path from "path";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
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

const clientDistPath = path.join(process.cwd(), "client", "dist");

app.use(express.static(clientDistPath));

// Reads the verified identity that Azure App Service Easy Auth injects via the
// `x-ms-client-principal` header (Microsoft/Google sign-in) and returns the
// signed-in user's email address, or null when there is no authenticated user.
function getPrincipalEmail(req: any): string | null {
  const principalHeader = req.headers["x-ms-client-principal"];

  if (!principalHeader) {
    return null;
  }

  try {
    const headerValue = Array.isArray(principalHeader)
      ? principalHeader[0]
      : principalHeader;

    const decoded = Buffer.from(headerValue, "base64").toString("utf8");
    const principal = JSON.parse(decoded);

    const claims = principal.claims || [];

    const emailClaim =
      claims.find((c: any) => c.typ === "preferred_username") ||
      claims.find((c: any) => c.typ === "email") ||
      claims.find((c: any) => c.typ === "emails") ||
      claims.find((c: any) => c.typ === "upn") ||
      claims.find(
        (c: any) =>
          c.typ ===
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
      );

    const email = emailClaim?.val?.toLowerCase();

    return email || null;
  } catch {
    return null;
  }
}

// Resolves what a signed-in account is allowed to do, keyed off their email.
// A user may update the site when their email matches an active club member
// (ClubMembers) or an active entry on the AllowedUsers allow-list. Admin powers
// come from an active AllowedUsers row flagged IsAdmin.
async function resolveUserAccess(
  pool: any,
  email: string
): Promise<{ isAllowed: boolean; isAdmin: boolean }> {
  const normalisedEmail = email.trim().toLowerCase();

  const result = await pool.request()
    .input("Email", sql.NVarChar(255), normalisedEmail)
    .query(`
      SELECT
        CASE WHEN EXISTS (
          SELECT 1 FROM ClubMembers
          WHERE LOWER(Email) = @Email AND IsActive = 1
        ) THEN 1 ELSE 0 END AS IsMember,
        CASE WHEN EXISTS (
          SELECT 1 FROM AllowedUsers
          WHERE LOWER(Email) = @Email AND IsActive = 1
        ) THEN 1 ELSE 0 END AS IsAllowedUser,
        CASE WHEN EXISTS (
          SELECT 1 FROM AllowedUsers
          WHERE LOWER(Email) = @Email AND IsActive = 1 AND IsAdmin = 1
        ) THEN 1 ELSE 0 END AS IsAdmin
    `);

  const row = result.recordset[0];

  const isMember = row.IsMember === 1;
  const isAllowedUser = row.IsAllowedUser === 1;
  const isAdmin = row.IsAdmin === 1;

  return {
    isAllowed: isMember || isAllowedUser,
    isAdmin
  };
}

// Authorisation guard for add/edit/delete: the signed-in account's email must
// match an active club member (or an active AllowedUsers entry). Read-only
// requests are allowed through without this check.
async function requireAllowedUser(req: any, res: any, next: any) {
  try {
    const email = getPrincipalEmail(req);

    if (!email) {
      return res.status(401).json({ error: "Not signed in" });
    }

    const pool = await poolPromise;

    const access = await resolveUserAccess(pool, email);

    if (!access.isAllowed) {
      return res.status(403).json({
        error: "Access denied - email is not a registered club member",
        email
      });
    }

    req.userEmail = email;
    req.isAdmin = access.isAdmin;
    next();
  } catch (error: any) {
    res.status(500).json({
      error: "Authorization check failed",
      details: error.message
    });
  }
}

// Ensures the supplied email is present in the AllowedUsers allow-list and is
// flagged as an administrator. Used to keep every club member in the admin
// group automatically. No-ops when the member has no email address.
async function ensureMemberInAdminGroup(
  pool: any,
  email: string | null | undefined
): Promise<void> {
  const normalisedEmail = email?.trim().toLowerCase();

  if (!normalisedEmail) {
    return;
  }

  await pool.request()
    .input("Email", sql.NVarChar(255), normalisedEmail)
    .query(`
      MERGE AllowedUsers AS target
      USING (SELECT @Email AS Email) AS source
        ON LOWER(target.Email) = source.Email
      WHEN MATCHED THEN
        UPDATE SET IsAdmin = 1, IsActive = 1
      WHEN NOT MATCHED THEN
        INSERT (Email, IsActive, IsAdmin)
        VALUES (source.Email, 1, 1);
    `);
}

// On startup, make sure every existing club member that has an email address is
// part of the admin group. Idempotent, so it is safe to run on every boot.
async function backfillMembersIntoAdminGroup(): Promise<void> {
  try {
    const pool = await poolPromise;

    await pool.request().query(`
      MERGE AllowedUsers AS target
      USING (
        SELECT DISTINCT LOWER(LTRIM(RTRIM(Email))) AS Email
        FROM ClubMembers
        WHERE Email IS NOT NULL AND LTRIM(RTRIM(Email)) <> ''
      ) AS source
        ON LOWER(target.Email) = source.Email
      WHEN MATCHED THEN
        UPDATE SET IsAdmin = 1, IsActive = 1
      WHEN NOT MATCHED THEN
        INSERT (Email, IsActive, IsAdmin)
        VALUES (source.Email, 1, 1);
    `);

    console.log("Synced existing club members into the admin group");
  } catch (error: any) {
    console.error("Failed to sync members into the admin group", error);
  }
}

// Creates the tables that back the tournament voting feature when they are not
// already present. Runs on startup and is idempotent, so it is safe to call on
// every boot. Members vote on individual candidate dates (approval voting), so
// uniqueness is enforced per option via (TournamentOptionId, VoterEmail).
async function ensureTournamentTables(): Promise<void> {
  try {
    const pool = await poolPromise;

    await pool.request().query(`
      IF OBJECT_ID('dbo.Tournaments', 'U') IS NULL
      BEGIN
        CREATE TABLE Tournaments (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Title NVARCHAR(150) NOT NULL,
          Description NVARCHAR(500) NULL,
          Status NVARCHAR(20) NOT NULL
            CONSTRAINT DF_Tournaments_Status DEFAULT 'open',
          CreatedByEmail NVARCHAR(255) NULL,
          CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_Tournaments_CreatedAt DEFAULT SYSUTCDATETIME()
        );
      END;

      IF OBJECT_ID('dbo.TournamentOptions', 'U') IS NULL
      BEGIN
        CREATE TABLE TournamentOptions (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          TournamentId INT NOT NULL,
          Title NVARCHAR(150) NOT NULL,
          ProposedDate DATE NULL,
          Theme NVARCHAR(200) NULL,
          Format NVARCHAR(200) NULL,
          CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_TournamentOptions_CreatedAt DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_TournamentOptions_Tournaments FOREIGN KEY (TournamentId)
            REFERENCES Tournaments(Id) ON DELETE CASCADE
        );
      END;

      IF OBJECT_ID('dbo.TournamentVotes', 'U') IS NULL
      BEGIN
        CREATE TABLE TournamentVotes (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          TournamentId INT NOT NULL,
          TournamentOptionId INT NOT NULL,
          VoterEmail NVARCHAR(255) NOT NULL,
          CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_TournamentVotes_CreatedAt DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_TournamentVotes_Tournaments FOREIGN KEY (TournamentId)
            REFERENCES Tournaments(Id) ON DELETE CASCADE,
          CONSTRAINT UQ_TournamentVotes_Option UNIQUE (TournamentOptionId, VoterEmail)
        );
      END;
    `);

    // Migrate older installs that allowed only one vote per tournament to the
    // per-date (approval) model. Drops the old constraint, removes any rows that
    // would clash on the new key, then adds the per-option unique constraint.
    await pool.request().query(`
      IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_TournamentVotes_Voter')
      BEGIN
        ALTER TABLE TournamentVotes DROP CONSTRAINT UQ_TournamentVotes_Voter;
      END;

      IF OBJECT_ID('dbo.TournamentVotes', 'U') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_TournamentVotes_Option')
      BEGIN
        DELETE v
        FROM TournamentVotes v
        JOIN (
          SELECT Id,
                 ROW_NUMBER() OVER (
                   PARTITION BY TournamentOptionId, LOWER(VoterEmail)
                   ORDER BY Id
                 ) AS rn
          FROM TournamentVotes
        ) d ON d.Id = v.Id
        WHERE d.rn > 1;

        ALTER TABLE TournamentVotes
          ADD CONSTRAINT UQ_TournamentVotes_Option UNIQUE (TournamentOptionId, VoterEmail);
      END;
    `);

    console.log("Ensured tournament tables exist");
  } catch (error: any) {
    console.error("Failed to ensure tournament tables", error);
  }
}

// Creates the ActivityLog table that backs the in-app notification centre.
// Each row is a short, human-readable record of something that changed (a new
// photo, whisky, session, etc.). Idempotent, so it is safe to call on boot.
async function ensureActivityTable(): Promise<void> {
  try {
    const pool = await poolPromise;

    await pool.request().query(`
      IF OBJECT_ID('dbo.ActivityLog', 'U') IS NULL
      BEGIN
        CREATE TABLE ActivityLog (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Type NVARCHAR(50) NOT NULL,
          Message NVARCHAR(300) NOT NULL,
          CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_ActivityLog_CreatedAt DEFAULT SYSUTCDATETIME()
        );
      END;
    `);

    console.log("Ensured activity table exists");
  } catch (error: any) {
    console.error("Failed to ensure activity table", error);
  }
}

// Records a single activity entry for the notification feed. Best-effort: any
// failure is logged but never thrown, so notification logging can never break
// the primary request that triggered it.
async function logActivity(type: string, message: string): Promise<void> {
  try {
    const pool = await poolPromise;

    await pool.request()
      .input("Type", sql.NVarChar(50), type)
      .input("Message", sql.NVarChar(300), message)
      .query(`
        INSERT INTO ActivityLog (Type, Message)
        VALUES (@Type, @Message)
      `);
  } catch (error: any) {
    console.error("Failed to log activity", error);
  }
}

// Enforce sign-in + allow-list on every mutating API request, regardless of the
// order in which individual routes are registered below. Safe (read-only)
// methods are left open so the public can still view sessions, whiskies, etc.
app.use("/api", (req: any, res: any, next: any) => {
  const method = req.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  return requireAllowedUser(req, res, next);
});


const port = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage()
  });

  const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const storageContainerName =
    process.env.AZURE_STORAGE_CONTAINER_NAME || "whisky-images";

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

    const insertedEntry = result.recordset[0];

    try {
      const whiskyRow = await pool.request()
        .input("WhiskyId", sql.Int, whiskyId)
        .query(`SELECT Name FROM Whiskies WHERE Id = @WhiskyId`);
      const whiskyName = whiskyRow.recordset[0]?.Name ?? "a whisky";
      await logActivity("entry", `📝 New tasting notes added for ${whiskyName}`);
    } catch (activityError) {
      console.error("Failed to log tasting-entry activity", activityError);
    }

    res.status(201).json(insertedEntry);
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

// Lets the frontend discover the current sign-in state and whether the account
// is permitted to add/edit (i.e. a registered club member or allowed user).
app.get("/api/me", async (req, res) => {
  try {
    const email = getPrincipalEmail(req);

    if (!email) {
      return res.json({
        authenticated: false,
        email: null,
        isAllowed: false,
        isAdmin: false
      });
    }

    const pool = await poolPromise;

    const access = await resolveUserAccess(pool, email);

    res.json({
      authenticated: true,
      email,
      isAllowed: access.isAllowed,
      isAdmin: access.isAdmin
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to resolve identity",
      details: error.message
    });
  }
});

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

    await logActivity("session", `📅 New tasting session created: ${name}`);

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

    await logActivity("whisky", `🥃 New whisky added: ${name}`);

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
          w.ImageUrl,
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
          w.ImageUrl,
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

app.get("/api/leaderboard/whiskies", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        w.Id,
        w.Name,
        w.Distillery,
        w.Region,
        w.ImageUrl,
        COUNT(te.Id) AS TastingCount,
        AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScore
      FROM Whiskies w
      INNER JOIN TastingEntries te
        ON w.Id = te.WhiskyId
      WHERE te.OverallScore IS NOT NULL
      GROUP BY
        w.Id,
        w.Name,
        w.Distillery,
        w.Region,
        w.ImageUrl
      ORDER BY AverageScore DESC
    `);

    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to load whisky leaderboard",
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

    // Every club member is automatically part of the admin group.
    await ensureMemberInAdminGroup(pool, result.recordset[0].Email);

    await logActivity("member", `👤 New member added: ${name}`);

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

    // Keep the member in the admin group whenever they have an email.
    await ensureMemberInAdminGroup(pool, result.recordset[0].Email);

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

app.get("/api/sessions/:id/results", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const pool = await poolPromise;

    const rankings = await pool.request()
      .input("SessionId", sql.Int, sessionId)
      .query(`
        SELECT
          w.Id AS WhiskyId,
          w.Name AS WhiskyName,
          w.ImageUrl,
          COUNT(te.Id) AS EntryCount,
          AVG(CAST(te.NoseScore AS FLOAT)) AS AverageNoseScore,
          AVG(CAST(te.PalateScore AS FLOAT)) AS AveragePalateScore,
          AVG(CAST(te.FinishScore AS FLOAT)) AS AverageFinishScore,
          AVG(CAST(te.OverallScore AS FLOAT)) AS AverageOverallScore
        FROM TastingEntries te
        INNER JOIN Whiskies w ON te.WhiskyId = w.Id
        WHERE te.TastingSessionId = @SessionId
          AND te.OverallScore IS NOT NULL
        GROUP BY w.Id, w.Name, w.ImageUrl
        ORDER BY AverageOverallScore DESC
      `);

    const bestNose = await pool.request()
      .input("SessionId", sql.Int, sessionId)
      .query(`
        SELECT TOP 1
          w.Name AS WhiskyName,
          AVG(CAST(te.NoseScore AS FLOAT)) AS AverageScore
        FROM TastingEntries te
        INNER JOIN Whiskies w ON te.WhiskyId = w.Id
        WHERE te.TastingSessionId = @SessionId
          AND te.NoseScore IS NOT NULL
        GROUP BY w.Name
        ORDER BY AverageScore DESC
      `);

    const bestFinish = await pool.request()
      .input("SessionId", sql.Int, sessionId)
      .query(`
        SELECT TOP 1
          w.Name AS WhiskyName,
          AVG(CAST(te.FinishScore AS FLOAT)) AS AverageScore
        FROM TastingEntries te
        INNER JOIN Whiskies w ON te.WhiskyId = w.Id
        WHERE te.TastingSessionId = @SessionId
          AND te.FinishScore IS NOT NULL
        GROUP BY w.Name
        ORDER BY AverageScore DESC
      `);

    res.json({
      Rankings: rankings.recordset,
      BestNose: bestNose.recordset[0] || null,
      BestFinish: bestFinish.recordset[0] || null
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to load session results",
      details: error.message
    });
  }
});// all /api routes above here


app.get("/api/debug/leaderboard", async (_req, res) => {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT TOP 20
      WhiskyId,
      OverallScore
    FROM TastingEntries
  `);

  res.json(result.recordset);
});

app.get("/api/admin/allowed-users", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT Id, Email, IsActive, IsAdmin, CreatedAt
      FROM AllowedUsers
      ORDER BY Email
    `);

    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to retrieve allowed users",
      details: error.message
    });
  }
});

app.post("/api/admin/allowed-users", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "email is required"
      });
    }

    const pool = await poolPromise;

    const existingUser = await pool.request()
      .input("Email", sql.NVarChar(255), email.toLowerCase())
      .query(`
        SELECT TOP 1 Id
        FROM AllowedUsers
        WHERE LOWER(Email) = LOWER(@Email)
      `);

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({
        error: "User already exists"
      });
    }

    const result = await pool.request()
      .input("Email", sql.NVarChar(255), email.toLowerCase())
      .query(`
        INSERT INTO AllowedUsers (Email)
        OUTPUT INSERTED.*
        VALUES (@Email)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to create allowed user",
      details: error.message
    });
  }
});

app.get("/api/leaderboard/members", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const rankings = await pool.request().query(`
      SELECT
        cm.Id AS MemberId,
        cm.Name AS MemberName,
        cm.IsActive,
        COUNT(te.Id) AS TastingsSubmitted,
        AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScoreGiven,
        MIN(te.OverallScore) AS LowestScoreGiven,
        MAX(te.OverallScore) AS HighestScoreGiven
      FROM ClubMembers cm
      LEFT JOIN TastingEntries te
        ON cm.Id = te.ClubMemberId
        AND te.OverallScore IS NOT NULL
      GROUP BY
        cm.Id,
        cm.Name,
        cm.IsActive
      ORDER BY TastingsSubmitted DESC
    `);

    const harshestCritic = await pool.request().query(`
      SELECT TOP 1
        cm.Id AS MemberId,
        cm.Name AS MemberName,
        AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScoreGiven
      FROM ClubMembers cm
      INNER JOIN TastingEntries te
        ON cm.Id = te.ClubMemberId
      WHERE te.OverallScore IS NOT NULL
      GROUP BY cm.Id, cm.Name
      HAVING COUNT(te.Id) > 0
      ORDER BY AverageScoreGiven ASC
    `);

    const mostGenerous = await pool.request().query(`
      SELECT TOP 1
        cm.Id AS MemberId,
        cm.Name AS MemberName,
        AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScoreGiven
      FROM ClubMembers cm
      INNER JOIN TastingEntries te
        ON cm.Id = te.ClubMemberId
      WHERE te.OverallScore IS NOT NULL
      GROUP BY cm.Id, cm.Name
      HAVING COUNT(te.Id) > 0
      ORDER BY AverageScoreGiven DESC
    `);

    const mostActive = await pool.request().query(`
      SELECT TOP 1
        cm.Id AS MemberId,
        cm.Name AS MemberName,
        COUNT(te.Id) AS TastingsSubmitted
      FROM ClubMembers cm
      INNER JOIN TastingEntries te
        ON cm.Id = te.ClubMemberId
      WHERE te.OverallScore IS NOT NULL
      GROUP BY cm.Id, cm.Name
      ORDER BY TastingsSubmitted DESC
    `);

    const favouriteWhiskies = await pool.request().query(`
      WITH RankedWhiskies AS (
        SELECT
          cm.Id AS MemberId,
          w.Name AS WhiskyName,
          AVG(CAST(te.OverallScore AS FLOAT)) AS AverageScore,
          ROW_NUMBER() OVER (
            PARTITION BY cm.Id
            ORDER BY AVG(CAST(te.OverallScore AS FLOAT)) DESC
          ) AS rn
        FROM ClubMembers cm
        INNER JOIN TastingEntries te
          ON cm.Id = te.ClubMemberId
        INNER JOIN Whiskies w
          ON te.WhiskyId = w.Id
        WHERE te.OverallScore IS NOT NULL
        GROUP BY cm.Id, w.Name
      )
      SELECT
        MemberId,
        WhiskyName,
        AverageScore
      FROM RankedWhiskies
      WHERE rn = 1
    `);

        res.json({
      Rankings: rankings.recordset.map(member => {
        const favourite = favouriteWhiskies.recordset.find(
          whisky => whisky.MemberId === member.MemberId
        );

        return {
          ...member,
          FavouriteWhisky: favourite || null
        };
      }),
      HarshestCritic: harshestCritic.recordset[0] || null,
      MostGenerousScorer: mostGenerous.recordset[0] || null,
      MostActiveMember: mostActive.recordset[0] || null
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to load member leaderboard",
      details: error.message
    });
  }
});

app.put("/api/admin/allowed-users/:id", async (req, res) => {
  try {
    const allowedUserId = Number(req.params.id);
    const { email, isActive, isAdmin } = req.body;

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, allowedUserId)
      .input("Email", sql.NVarChar(255), email.toLowerCase())
      .input("IsActive", sql.Bit, isActive)
      .input("IsAdmin", sql.Bit, isAdmin)
      .query(`
        UPDATE AllowedUsers
          SET
            Email = @Email,
            IsActive = @IsActive,
            IsAdmin = @IsAdmin
          OUTPUT INSERTED.*
          WHERE Id = @Id
      `);
      
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Allowed user not found" });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to update allowed user",
      details: error.message
    });
}
});

app.post(
  "/api/uploads/whisky-image",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!storageConnectionString) {
        return res.status(500).json({
          error: "Azure storage connection string is not configured"
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No image file uploaded"
        });
      }

      const blobServiceClient =
        BlobServiceClient.fromConnectionString(storageConnectionString);

      const containerClient =
        blobServiceClient.getContainerClient(storageContainerName);

      const fileExtension =
        req.file.originalname.split(".").pop() || "jpg";

      const blobName =
        `whiskies/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${fileExtension}`;

      const blockBlobClient =
        containerClient.getBlockBlobClient(blobName);

      await blockBlobClient.uploadData(req.file.buffer, {
        blobHTTPHeaders: {
          blobContentType: req.file.mimetype
        }
      });

      res.json({
        imageUrl: blockBlobClient.url
      });
    } catch (error: any) {
      res.status(500).json({
        error: "Failed to upload whisky image",
        details: error.message
      });
    }
  }
);

app.get("/api/sessions/:id/photos", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const pool = await poolPromise;

    const result = await pool.request()
      .input("SessionId", sql.Int, sessionId)
      .query(`
        SELECT Id, TastingSessionId, ImageUrl, Caption, CreatedAt
        FROM SessionPhotos
        WHERE TastingSessionId = @SessionId
        ORDER BY CreatedAt DESC
      `);

    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to load session photos",
      details: error.message
    });
  }
});


app.post("/api/sessions/:id/photos", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const { imageUrl, caption } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl is required" });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input("SessionId", sql.Int, sessionId)
      .input("ImageUrl", sql.NVarChar(1000), imageUrl)
      .input("Caption", sql.NVarChar(500), caption || null)
      .query(`
        INSERT INTO SessionPhotos (TastingSessionId, ImageUrl, Caption)
        OUTPUT INSERTED.*
        VALUES (@SessionId, @ImageUrl, @Caption)
      `);

    try {
      const sessionRow = await pool.request()
        .input("SessionId", sql.Int, sessionId)
        .query(`SELECT Name FROM TastingSessions WHERE Id = @SessionId`);
      const sessionName = sessionRow.recordset[0]?.Name ?? "a session";
      await logActivity("photo", `📸 New photo added to ${sessionName}`);
    } catch (activityError) {
      console.error("Failed to log photo activity", activityError);
    }

    res.status(201).json(result.recordset[0]);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to save session photo",
      details: error.message
    });
  }
});

app.delete("/api/session-photos/:id", async (req, res) => {
  try {
    const photoId = Number(req.params.id);
    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, photoId)
      .query(`
        DELETE FROM SessionPhotos
        OUTPUT DELETED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Photo not found" });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete session photo",
      details: error.message
    });
  }
});


// Public feed of recent activity that powers the in-app notification centre.
// Returns the most recent entries, newest first. Open to all viewers (GET), so
// everyone sees notifications regardless of sign-in state.
app.get("/api/activity", async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT TOP 50 Id, Type, Message, CreatedAt
      FROM ActivityLog
      ORDER BY Id DESC
    `);

    res.json(result.recordset);
  } catch (error: any) {
    console.error("Failed to load activity", error);
    res.status(500).json({
      error: "Failed to load activity",
      details: error.message
    });
  }
});


// ---------------------------------------------------------------------------
// Tournament voting
//
// Members propose options for a future tournament (date / theme / format) and
// vote for the one they prefer. Voting is open: the running tally is always
// visible, and each signed-in member may cast a single, changeable vote per
// tournament (enforced by UQ_TournamentVotes_Voter).
// ---------------------------------------------------------------------------

// List every tournament with its option/vote counts and, when the caller is
// signed in, which option they have voted for. Open tournaments are listed
// first, then by most recently created.
app.get("/api/tournaments", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .query(`
        SELECT
          t.Id,
          t.Title,
          t.Description,
          t.Status,
          t.CreatedByEmail,
          t.CreatedAt,
          (SELECT COUNT(*) FROM TournamentOptions o WHERE o.TournamentId = t.Id) AS OptionCount,
          (SELECT COUNT(*) FROM TournamentVotes v WHERE v.TournamentId = t.Id) AS VoteCount
        FROM Tournaments t
        ORDER BY
          CASE WHEN t.Status = 'open' THEN 0 ELSE 1 END,
          t.CreatedAt DESC
      `);

    res.json(result.recordset);
  } catch (error: any) {
    console.error("Failed to retrieve tournaments", error);
    res.status(500).json({
      error: "Failed to retrieve tournaments",
      details: error.message
    });
  }
});

// Full detail for a single tournament: its candidate dates (options) with live
// vote tallies and, for the signed-in caller, whether they have voted for each.
app.get("/api/tournaments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const email = getPrincipalEmail(req);
    const pool = await poolPromise;

    const tournamentResult = await pool.request()
      .input("Id", sql.Int, id)
      .query(`SELECT * FROM Tournaments WHERE Id = @Id`);

    if (tournamentResult.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const optionsResult = await pool.request()
      .input("TournamentId", sql.Int, id)
      .input("VoterEmail", sql.NVarChar(255), email ? email.toLowerCase() : null)
      .query(`
        SELECT
          o.Id,
          o.TournamentId,
          o.Title,
          o.ProposedDate,
          o.Theme,
          o.Format,
          o.CreatedAt,
          (SELECT COUNT(*) FROM TournamentVotes v WHERE v.TournamentOptionId = o.Id) AS VoteCount,
          CASE WHEN EXISTS (
            SELECT 1 FROM TournamentVotes v
            WHERE v.TournamentOptionId = o.Id AND LOWER(v.VoterEmail) = @VoterEmail
          ) THEN 1 ELSE 0 END AS MyVote
        FROM TournamentOptions o
        WHERE o.TournamentId = @TournamentId
        ORDER BY o.ProposedDate ASC, o.CreatedAt ASC
      `);

    res.json({
      ...tournamentResult.recordset[0],
      Options: optionsResult.recordset.map((o: any) => ({
        ...o,
        MyVote: o.MyVote === 1
      }))
    });
  } catch (error: any) {
    console.error("Failed to retrieve tournament", error);
    res.status(500).json({
      error: "Failed to retrieve tournament",
      details: error.message
    });
  }
});

// Create a tournament. An optional array of initial options may be supplied so
// a proposer can seed the poll with the dates/themes they have in mind.
app.post("/api/tournaments", async (req: any, res) => {
  try {
    const { title, description, options } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const pool = await poolPromise;

    const created = await pool.request()
      .input("Title", sql.NVarChar(150), title.trim())
      .input("Description", sql.NVarChar(500), description?.trim() || null)
      .input("CreatedByEmail", sql.NVarChar(255), req.userEmail || null)
      .query(`
        INSERT INTO Tournaments (Title, Description, CreatedByEmail)
        OUTPUT INSERTED.*
        VALUES (@Title, @Description, @CreatedByEmail)
      `);

    const tournament = created.recordset[0];

    if (Array.isArray(options)) {
      for (const opt of options) {
        if (!opt || !opt.title || !opt.title.trim()) {
          continue;
        }

        await pool.request()
          .input("TournamentId", sql.Int, tournament.Id)
          .input("Title", sql.NVarChar(150), opt.title.trim())
          .input("ProposedDate", sql.Date, opt.proposedDate || null)
          .input("Theme", sql.NVarChar(200), opt.theme?.trim() || null)
          .input("Format", sql.NVarChar(200), opt.format?.trim() || null)
          .query(`
            INSERT INTO TournamentOptions (TournamentId, Title, ProposedDate, Theme, Format)
            VALUES (@TournamentId, @Title, @ProposedDate, @Theme, @Format)
          `);
      }
    }

    res.status(201).json(tournament);
  } catch (error: any) {
    console.error("Failed to create tournament", error);
    res.status(500).json({
      error: "Failed to create tournament",
      details: error.message
    });
  }
});

// Update a tournament's title/description/status. Used to close (or re-open)
// voting once the club has settled on a tournament.
app.put("/api/tournaments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { title, description, status } = req.body;

    if (status && status !== "open" && status !== "closed") {
      return res.status(400).json({ error: "status must be 'open' or 'closed'" });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("Title", sql.NVarChar(150), title?.trim() || null)
      .input("Description", sql.NVarChar(500), description?.trim() ?? null)
      .input("Status", sql.NVarChar(20), status || null)
      .query(`
        UPDATE Tournaments
        SET
          Title = COALESCE(@Title, Title),
          Description = CASE WHEN @Title IS NULL AND @Status IS NULL THEN Description ELSE @Description END,
          Status = COALESCE(@Status, Status)
        OUTPUT INSERTED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    res.json(result.recordset[0]);
  } catch (error: any) {
    console.error("Failed to update tournament", error);
    res.status(500).json({
      error: "Failed to update tournament",
      details: error.message
    });
  }
});

// Delete a tournament. Options and votes are removed automatically via the
// ON DELETE CASCADE foreign keys.
app.delete("/api/tournaments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await poolPromise;

    const result = await pool.request()
      .input("Id", sql.Int, id)
      .query(`
        DELETE FROM Tournaments
        OUTPUT DELETED.*
        WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Failed to delete tournament", error);
    res.status(500).json({
      error: "Failed to delete tournament",
      details: error.message
    });
  }
});

// Add a new option to an existing tournament. Anyone allowed to edit may
// suggest an alternative date/theme/format while voting is open.
app.post("/api/tournaments/:id/options", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const { title, proposedDate, theme, format } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const pool = await poolPromise;

    const tournament = await pool.request()
      .input("Id", sql.Int, tournamentId)
      .query(`SELECT Status FROM Tournaments WHERE Id = @Id`);

    if (tournament.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    if (tournament.recordset[0].Status !== "open") {
      return res.status(409).json({ error: "Voting is closed for this tournament" });
    }

    const result = await pool.request()
      .input("TournamentId", sql.Int, tournamentId)
      .input("Title", sql.NVarChar(150), title.trim())
      .input("ProposedDate", sql.Date, proposedDate || null)
      .input("Theme", sql.NVarChar(200), theme?.trim() || null)
      .input("Format", sql.NVarChar(200), format?.trim() || null)
      .query(`
        INSERT INTO TournamentOptions (TournamentId, Title, ProposedDate, Theme, Format)
        OUTPUT INSERTED.*
        VALUES (@TournamentId, @Title, @ProposedDate, @Theme, @Format)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error: any) {
    console.error("Failed to add tournament option", error);
    res.status(500).json({
      error: "Failed to add tournament option",
      details: error.message
    });
  }
});

// Delete an option. Its votes are removed first because votes intentionally do
// not cascade from options (only from the parent tournament).
app.delete("/api/tournament-options/:id", async (req, res) => {
  try {
    const optionId = Number(req.params.id);
    const pool = await poolPromise;

    await pool.request()
      .input("OptionId", sql.Int, optionId)
      .query(`DELETE FROM TournamentVotes WHERE TournamentOptionId = @OptionId`);

    const result = await pool.request()
      .input("OptionId", sql.Int, optionId)
      .query(`
        DELETE FROM TournamentOptions
        OUTPUT DELETED.*
        WHERE Id = @OptionId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Option not found" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Failed to delete tournament option", error);
    res.status(500).json({
      error: "Failed to delete tournament option",
      details: error.message
    });
  }
});

// Toggle the signed-in member's vote on a single candidate date. Approval
// voting: a member may vote for any number of dates, and clicking an option
// they already voted for removes that vote.
app.post("/api/tournament-options/:id/vote", async (req: any, res) => {
  try {
    const optionId = Number(req.params.id);
    const voterEmail = (req.userEmail as string).toLowerCase();

    const pool = await poolPromise;

    const option = await pool.request()
      .input("OptionId", sql.Int, optionId)
      .query(`
        SELECT o.Id, o.TournamentId, t.Status
        FROM TournamentOptions o
        JOIN Tournaments t ON t.Id = o.TournamentId
        WHERE o.Id = @OptionId
      `);

    if (option.recordset.length === 0) {
      return res.status(404).json({ error: "Option not found" });
    }

    if (option.recordset[0].Status !== "open") {
      return res.status(409).json({ error: "Voting is closed for this tournament" });
    }

    const tournamentId = option.recordset[0].TournamentId;

    const existing = await pool.request()
      .input("OptionId", sql.Int, optionId)
      .input("VoterEmail", sql.NVarChar(255), voterEmail)
      .query(`
        SELECT Id FROM TournamentVotes
        WHERE TournamentOptionId = @OptionId AND LOWER(VoterEmail) = @VoterEmail
      `);

    let voted: boolean;

    if (existing.recordset.length > 0) {
      await pool.request()
        .input("OptionId", sql.Int, optionId)
        .input("VoterEmail", sql.NVarChar(255), voterEmail)
        .query(`
          DELETE FROM TournamentVotes
          WHERE TournamentOptionId = @OptionId AND LOWER(VoterEmail) = @VoterEmail
        `);
      voted = false;
    } else {
      await pool.request()
        .input("TournamentId", sql.Int, tournamentId)
        .input("OptionId", sql.Int, optionId)
        .input("VoterEmail", sql.NVarChar(255), voterEmail)
        .query(`
          INSERT INTO TournamentVotes (TournamentId, TournamentOptionId, VoterEmail)
          VALUES (@TournamentId, @OptionId, @VoterEmail)
        `);
      voted = true;
    }

    res.json({ success: true, voted });
  } catch (error: any) {
    console.error("Failed to record vote", error);
    res.status(500).json({
      error: "Failed to record vote",
      details: error.message
    });
  }
});

// Pick the winning date: keep the most-voted candidate (ties broken by the
// earliest date), remove all other dates and their votes, and close voting.
app.post("/api/tournaments/:id/pick-winner", async (req: any, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const pool = await poolPromise;

    const tournament = await pool.request()
      .input("Id", sql.Int, tournamentId)
      .query(`SELECT Id FROM Tournaments WHERE Id = @Id`);

    if (tournament.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const winner = await pool.request()
      .input("TournamentId", sql.Int, tournamentId)
      .query(`
        SELECT TOP 1
          o.Id,
          (SELECT COUNT(*) FROM TournamentVotes v WHERE v.TournamentOptionId = o.Id) AS VoteCount
        FROM TournamentOptions o
        WHERE o.TournamentId = @TournamentId
        ORDER BY VoteCount DESC, o.ProposedDate ASC, o.Id ASC
      `);

    if (winner.recordset.length === 0) {
      return res.status(400).json({ error: "Tournament has no dates to choose from" });
    }

    const winnerId = winner.recordset[0].Id;

    await pool.request()
      .input("TournamentId", sql.Int, tournamentId)
      .input("WinnerId", sql.Int, winnerId)
      .query(`
        DELETE FROM TournamentVotes
        WHERE TournamentId = @TournamentId AND TournamentOptionId <> @WinnerId;

        DELETE FROM TournamentOptions
        WHERE TournamentId = @TournamentId AND Id <> @WinnerId;

        UPDATE Tournaments SET Status = 'closed' WHERE Id = @TournamentId;
      `);

    try {
      const titleRow = await pool.request()
        .input("Id", sql.Int, tournamentId)
        .query(`SELECT Title FROM Tournaments WHERE Id = @Id`);
      const title = titleRow.recordset[0]?.Title ?? "a tasting session";
      await logActivity("session-finalised", `🏆 Date finalised for ${title}`);
    } catch (activityError) {
      console.error("Failed to log finalise activity", activityError);
    }

    res.json({ success: true, winnerOptionId: winnerId });
  } catch (error: any) {
    console.error("Failed to pick winner", error);
    res.status(500).json({
      error: "Failed to pick winner",
      details: error.message
    });
  }
});


app.use((_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Whisky Club API running on port ${port}`);
  backfillMembersIntoAdminGroup();
  ensureTournamentTables();
  ensureActivityTable();
});
