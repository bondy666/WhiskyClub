import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";


type Session = {
  Id: number;
  Name: string;
  SessionDate: string;
  Theme?: string;
  Status: string;
};



const API_URL = "https://whiskyclub-web-akc8dgc8dtfndugm.ukwest-01.azurewebsites.net";

function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [theme, setTheme] = useState("");

  async function loadSessions() {
    const res = await fetch(`${API_URL}/api/sessions`);
    const data = await res.json();
    setSessions(data);
  }

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
      alert(`Failed: ${res.status} ${errorText}`);
      return;
    }

    setName("");
    setSessionDate("");
    setTheme("");

    await loadSessions();
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSessions();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <h2>Create Session</h2>

      <form onSubmit={createSession} style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}>
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
        </div>
      ))}
    </>
  );
}

type Whisky = {
  Id: number;
  Name: string;
  Distillery?: string;
  Region?: string;
  AgeYears?: number;
  ABV?: number;
  Price?: number;
};

function WhiskiesPage() {
  const [whiskies, setWhiskies] = useState<Whisky[]>([]);
  const [name, setName] = useState("");
  const [distillery, setDistillery] = useState("");
  const [region, setRegion] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [abv, setAbv] = useState("");
  const [price, setPrice] = useState("");

  async function loadWhiskies() {
    const res = await fetch(`${API_URL}/api/whiskies`);
    const data = await res.json();
    setWhiskies(data);
  }

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
      alert(`Failed: ${res.status} ${errorText}`);
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
    const timer = setTimeout(() => {
      void loadWhiskies();
    }, 0);

    return () => clearTimeout(timer);
  }, []);


  return (
    <>
      <h2>Add Whisky</h2>

      <form onSubmit={createWhisky} style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}>
        <input placeholder="Whisky name" value={name} onChange={e => setName(e.target.value)} required />
        <input placeholder="Distillery" value={distillery} onChange={e => setDistillery(e.target.value)} />
        <input placeholder="Region" value={region} onChange={e => setRegion(e.target.value)} />
        <input placeholder="Age" type="number" value={ageYears} onChange={e => setAgeYears(e.target.value)} />
        <input placeholder="ABV" type="number" step="0.1" value={abv} onChange={e => setAbv(e.target.value)} />
        <input placeholder="Price" type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} />

        <button type="submit">Add Whisky</button>
      </form>

      <h2>Whiskies</h2>

      {whiskies.map(whisky => (
        <div key={whisky.Id} style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem", borderRadius: "8px" }}>
          <strong>{whisky.Name}</strong>
          <p>{whisky.Distillery}</p>
          <p>{whisky.Region}</p>
          <small>
            {whisky.AgeYears ? `${whisky.AgeYears} years` : ""}{" "}
            {whisky.ABV ? `${whisky.ABV}%` : ""}{" "}
            {whisky.Price ? `£${whisky.Price}` : ""}
          </small>
        </div>
      ))}
    </>
  );
}

function SessionDetailPage() {
  const { id } = useParams();

  const [whiskies, setWhiskies] = useState<Whisky[]>([]);
  const [whiskyId, setWhiskyId] = useState("");
  const [noseNotes, setNoseNotes] = useState("");
  const [palateNotes, setPalateNotes] = useState("");
  const [finishNotes, setFinishNotes] = useState("");
  const [score, setScore] = useState("");

  async function loadWhiskies() {
    const res = await fetch(`${API_URL}/api/whiskies`);
    const data = await res.json();
    setWhiskies(data);
  }

  async function createTastingEntry(e: React.FormEvent) {
    e.preventDefault();

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
        score: score ? Number(score) : null
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed: ${res.status} ${errorText}`);
      return;
    }

    setWhiskyId("");
    setNoseNotes("");
    setPalateNotes("");
    setFinishNotes("");
    setScore("");

    alert("Tasting entry saved");
  }

  useEffect(() => {
    const load = async () => {
      await loadWhiskies();
    };

    void load();
  }, []);





  return (
    <>
      <h2>Add Tasting Entry</h2>
      <p>Session ID: {id}</p>

      <form onSubmit={createTastingEntry} style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}>
        <select value={whiskyId} onChange={e => setWhiskyId(e.target.value)} required>
          <option value="">Select whisky</option>
          {whiskies.map(whisky => (
            <option key={whisky.Id} value={whisky.Id}>
              {whisky.Name}
            </option>
          ))}
        </select>

        <textarea placeholder="Nose notes" value={noseNotes} onChange={e => setNoseNotes(e.target.value)} />
        <textarea placeholder="Palate notes" value={palateNotes} onChange={e => setPalateNotes(e.target.value)} />
        <textarea placeholder="Finish notes" value={finishNotes} onChange={e => setFinishNotes(e.target.value)} />

        <input
          type="number"
          min="0"
          max="10"
          placeholder="Score out of 10"
          value={score}
          onChange={e => setScore(e.target.value)}
        />

        <button type="submit">Save Tasting Entry</button>
      </form>

      <Link to="/">Back to Sessions</Link>
    </>
  );
}

function App() {
  return (
    <main style={{ padding: "1rem", fontFamily: "Arial", maxWidth: "480px", margin: "0 auto" }}>
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