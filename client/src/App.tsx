import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";

type Session = {
  Id: number;
  Name: string;
  SessionDate: string;
  Theme?: string;
  Status: string;
};

type Whisky = {
  Id: number;
  Name: string;
  Distillery?: string;
  Region?: string;
  AgeYears?: number;
  ABV?: number;
  Price?: number;
};

type TastingEntry = {
  Id: number;
  WhiskyName: string;
  NoseNotes?: string;
  PalateNotes?: string;
  FinishNotes?: string;
  NoseScore?: number;
  PalateScore?: number;
  FinishScore?: number;
  OverallScore?: number;
  CreatedAt: string;
};

type SessionSummary = {
  WhiskyName: string;
  AverageScore: number;
  EntryCount: number;
};

const API_URL =
  "https://whiskyclub-web-akc8dgc8dtfndugm.ukwest-01.azurewebsites.net";

function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [theme, setTheme] = useState("");

const loadSessions = useCallback(async () => {
  const res = await fetch(`${API_URL}/api/sessions`);

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to load sessions: ${res.status} ${errorText}`);
    return;
  }

  const data = await res.json();
  console.log("Loaded sessions from API:", data);
  setSessions(data);
}, []);

  async function createSession(e: React.FormEvent) {
    e.preventDefault();

    const res = await fetch(`${API_URL}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        sessionDate,
        theme,
        status: "planned"
      })
    });


    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to create session: ${res.status} ${errorText}`);
      return;
    }

    setName("");
    setSessionDate("");
    setTheme("");

    await loadSessions();
  }
 
  async function deleteSession(id: number) {
  if (!confirm("Delete this session and its tasting entries?")) {
    return;
  }

  const res = await fetch(`${API_URL}/api/sessions/${id}`, {
    method: "DELETE"
  });

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to delete session: ${res.status} ${errorText}`);
    return;
  }

  await loadSessions();
}

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <>
      <h2>Create Session</h2>

      <form
        onSubmit={createSession}
        style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}
      >
        <input
          placeholder="Session name"
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />

        <input
          type="date"
          value={sessionDate}
          onChange={e => setSessionDate(e.target.value)}
          required
        />

        <input
          placeholder="Theme"
          value={theme}
          onChange={e => setTheme(e.target.value)}
        />

        <button type="submit">Create Session</button>
      </form>

      <h2>Tasting Sessions</h2>

      {sessions.map(session => (
  <div
    key={session.Id}
    style={{
      border: "1px solid #ccc",
      padding: "1rem",
      marginBottom: "1rem",
      borderRadius: "8px"
    }}
  >
    <Link to={`/sessions/${session.Id}`}>
      <strong>{session.Name}</strong>
    </Link>

    <p>{new Date(session.SessionDate).toLocaleDateString()}</p>
    <p>{session.Theme}</p>

    <small>{session.Status}</small>

<br />

<button
  type="button"
  onClick={() => deleteSession(session.Id)}
  style={{
    marginTop: "0.75rem",
    padding: "0.5rem"
  }}
>
  Delete Session
</button>

  </div>
))}
    </>
  );
}

function WhiskiesPage() {
  const [whiskies, setWhiskies] = useState<Whisky[]>([]);
  const [name, setName] = useState("");
  const [distillery, setDistillery] = useState("");
  const [region, setRegion] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [abv, setAbv] = useState("");
  const [price, setPrice] = useState("");

  const loadWhiskies = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/whiskies`);

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to load whiskies: ${res.status} ${errorText}`);
      return;
    }

    const data = await res.json();
    setWhiskies(data);
  }, []);

  async function createWhisky(e: React.FormEvent) {
    e.preventDefault();

    const res = await fetch(`${API_URL}/api/whiskies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        distillery,
        region,
        ageYears: ageYears ? Number(ageYears) : null,
        abv: abv ? Number(abv) : null,
        price: price ? Number(price) : null
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to create whisky: ${res.status} ${errorText}`);
      return;
    }

    setName("");
    setDistillery("");
    setRegion("");
    setAgeYears("");
    setAbv("");
    setPrice("");

    await loadWhiskies();
  }

  useEffect(() => {
    void loadWhiskies();
  }, [loadWhiskies]);

  return (
    <>
      <h2>Add Whisky</h2>

      <form
        onSubmit={createWhisky}
        style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}
      >
        <input
          placeholder="Whisky name"
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />

        <input
          placeholder="Distillery"
          value={distillery}
          onChange={e => setDistillery(e.target.value)}
        />

        <input
          placeholder="Region"
          value={region}
          onChange={e => setRegion(e.target.value)}
        />

        <input
          placeholder="Age"
          type="number"
          value={ageYears}
          onChange={e => setAgeYears(e.target.value)}
        />

        <input
          placeholder="ABV"
          type="number"
          step="0.1"
          value={abv}
          onChange={e => setAbv(e.target.value)}
        />

        <input
          placeholder="Price"
          type="number"
          step="0.01"
          value={price}
          onChange={e => setPrice(e.target.value)}
        />

        <button type="submit">Add Whisky</button>
      </form>

      <h2>Whiskies</h2>

      {whiskies.map(whisky => (
        <div
          key={whisky.Id}
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "8px"
          }}
        >
          <strong>{whisky.Name}</strong>
          <p>{whisky.Distillery}</p>
          <p>{whisky.Region}</p>
          <small>
            {whisky.AgeYears ? `${whisky.AgeYears} years ` : ""}
            {whisky.ABV ? `${whisky.ABV}% ` : ""}
            {whisky.Price ? `£${whisky.Price}` : ""}
          </small>
        </div>
      ))}
    </>
  );
}

function SessionDetailPage() {
  const { id } = useParams();

  const [entries, setEntries] = useState<TastingEntry[]>([]);
  const [whiskies, setWhiskies] = useState<Whisky[]>([]);
  const [whiskyId, setWhiskyId] = useState("");
  const [noseNotes, setNoseNotes] = useState("");
  const [palateNotes, setPalateNotes] = useState("");
  const [finishNotes, setFinishNotes] = useState("");
  const [noseScore, setNoseScore] = useState("");
  const [palateScore, setPalateScore] = useState("");
  const [finishScore, setFinishScore] = useState("");
  const [overallScore, setOverallScore] = useState("");
  const [summary, setSummary] = useState<SessionSummary[]>([]);

  const loadWhiskies = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/whiskies`);

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to load whiskies: ${res.status} ${errorText}`);
      return;
    }

    const data = await res.json();
    setWhiskies(data);
  }, []);

  const loadSessionSummary = useCallback(async () => {
  if (!id) return;

  const res = await fetch(`${API_URL}/api/sessions/${id}/summary`);

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to load summary: ${res.status} ${errorText}`);
    return;
  }

  const data = await res.json();
  setSummary(data);
}, [id]);

  const loadTastingEntries = useCallback(async () => {
    if (!id) return;

    const res = await fetch(`${API_URL}/api/sessions/${id}/tasting-entries`);

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to load tasting entries: ${res.status} ${errorText}`);
      return;
    }

    const data = await res.json();
    setEntries(data);
  }, [id]);

  async function createTastingEntry(e: React.FormEvent) {
    e.preventDefault();

    if (!id) {
      alert("No session ID found.");
      return;
    }

    
    const res = await fetch(`${API_URL}/api/tasting-entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tastingSessionId: Number(id),
        whiskyId: Number(whiskyId),
        noseNotes,
        palateNotes,
        finishNotes,
        noseScore: noseScore ? Number(noseScore) : null,
        palateScore: palateScore ? Number(palateScore) : null,
        finishScore: finishScore ? Number(finishScore) : null,
        overallScore: overallScore ? Number(overallScore) : null
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to create tasting entry: ${res.status} ${errorText}`);
      return;
    }

  setWhiskyId("");
  setNoseNotes("");
  setPalateNotes("");
  setFinishNotes("");
  setNoseScore("");
  setPalateScore("");
  setFinishScore("");
  setOverallScore("");

  await loadTastingEntries();
  await loadSessionSummary();
  }

  useEffect(() => {
  void loadWhiskies();
  void loadTastingEntries();
  void loadSessionSummary();
}, [loadWhiskies, loadTastingEntries, loadSessionSummary]);

  return (
    <>
      <h2>Add Tasting Entry</h2>

      <form
        onSubmit={createTastingEntry}
        style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}
      >
        <select
          value={whiskyId}
          onChange={e => setWhiskyId(e.target.value)}
          required
        >
          <option value="">Select whisky</option>
          {whiskies.map(whisky => (
            <option key={whisky.Id} value={whisky.Id}>
              {whisky.Name}
            </option>
          ))}
        </select>

        <textarea
          placeholder="Nose notes"
          value={noseNotes}
          onChange={e => setNoseNotes(e.target.value)}
        />

        <textarea
          placeholder="Palate notes"
          value={palateNotes}
          onChange={e => setPalateNotes(e.target.value)}
        />

        <textarea
          placeholder="Finish notes"
          value={finishNotes}
          onChange={e => setFinishNotes(e.target.value)}
        />

        <input type="number" min="0" max="10" placeholder="Nose score" value={noseScore} onChange={e => setNoseScore(e.target.value)} />
        <input type="number" min="0" max="10" placeholder="Palate score" value={palateScore} onChange={e => setPalateScore(e.target.value)} />
        <input type="number" min="0" max="10" placeholder="Finish score" value={finishScore} onChange={e => setFinishScore(e.target.value)} />
        <input type="number" min="0" max="10" placeholder="Overall score" value={overallScore} onChange={e => setOverallScore(e.target.value)} />

        <button type="submit">Save Tasting Entry</button>
      </form>


      <h2>Leaderboard</h2>

      {summary.length === 0 ? (
        <p>No scores yet.</p>
      ) : (
        summary.map((item, index) => (
          <div
            key={item.WhiskyName}
            style={{
              border: "1px solid #ccc",
              padding: "1rem",
              marginBottom: "1rem",
              borderRadius: "8px"
            }}
          >
            <strong>
              {index + 1}. {item.WhiskyName}
            </strong>
            <p>Average score: {item.AverageScore.toFixed(1)}/10</p>
            <small>{item.EntryCount} entries</small>
          </div>
        ))
      )}

      <h2>Saved Tasting Entries</h2>

      {entries.map(entry => (
        <div
          key={entry.Id}
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "8px"
          }}
        >
          <strong>{entry.WhiskyName}</strong>
          <p>
            <strong>Nose:</strong> {entry.NoseNotes}
          </p>
          <p>
            <strong>Palate:</strong> {entry.PalateNotes}
          </p>
          <p>
            <strong>Finish:</strong> {entry.FinishNotes}
          </p>
          <p><strong>Nose score:</strong> {entry.NoseScore ?? "-"} / 10</p>
          <p><strong>Palate score:</strong> {entry.PalateScore ?? "-"} / 10</p>
          <p><strong>Finish score:</strong> {entry.FinishScore ?? "-"} / 10</p>
          <p><strong>Overall score:</strong> {entry.OverallScore ?? "-"} / 10</p>
        </div>
      ))}

      <Link to="/">Back to Sessions</Link>
    </>
  );
}

function App() {
  return (
    <main
      style={{
        padding: "1rem",
        fontFamily: "Arial",
        maxWidth: "480px",
        margin: "0 auto"
      }}
    >
      <h1>Whisky Club</h1>

      <nav style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
        <Link to="/">Sessions</Link>
        <Link to="/whiskies">Whiskies</Link>
      </nav>

      <Routes>
        <Route path="/" element={<SessionsPage />} />
        <Route path="/whiskies" element={<WhiskiesPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </main>
  );
}

export default App;