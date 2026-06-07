import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNavigate } from "react-router-dom";

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
  ImageUrl?: string;
};

type TastingEntry = {
  Id: number;
  WhiskyName: string;

  ClubMemberId?: number;
  MemberName?: string;

  NoseNotes?: string;
  PalateNotes?: string;
  FinishNotes?: string;
  NoseScore?: number;
  PalateScore?: number;
  FinishScore?: number;
  OverallScore?: number;
  CreatedAt: string;
};

type MemberStats = {
  Id: number;
  Name: string;
  Email?: string;
  IsActive: boolean;
  TastingsSubmitted: number;
  AverageScoreGiven?: number;
  HighestScoreGiven?: number;
  LowestScoreGiven?: number;
  FavouriteWhisky?: {
    WhiskyName: string;
    OverallScore: number;
  } | null;
};

type WhiskyStats = {
  Id: number;
  Name: string;
  Distillery?: string;
  Region?: string;
  TimesTasted: number;
  AverageOverallScore?: number;
  BestScore?: number;
  WorstScore?: number;
};

type DashboardData = {
  SessionCount: number;
  WhiskyCount: number;
  TastingEntryCount: number;
  ActiveMemberCount: number;
  AverageOverallScore?: number;
  TopWhisky?: {
    WhiskyName: string;
    AverageScore: number;
  } | null;
  MostActiveMember?: {
    MemberName: string;
    TastingCount: number;
  } | null;
  RecentSessions: Session[];
};

type SessionSummary = {
  WhiskyName: string;
  AverageScore: number;
  EntryCount: number;
};

type Member = {
  Id: number;
  Name: string;
  Email?: string;
  IsActive: boolean;
  CreatedAt: string;
};

const API_URL =
  "https://whiskyclub-web-akc8dgc8dtfndugm.ukwest-01.azurewebsites.net";

function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [theme, setTheme] = useState("");
  const [status, setStatus] = useState("planned");
  const [editingId, setEditingId] = useState<number | null>(null);

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

  const url = editingId
    ? `${API_URL}/api/sessions/${editingId}`
    : `${API_URL}/api/sessions`;

  const method = editingId ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
    name,
    sessionDate,
    theme,
    status
  })
  });

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to save session: ${res.status} ${errorText}`);
    return;
  }

  setName("");
  setSessionDate("");
  setTheme("");
  setStatus("planned");
  setEditingId(null);

  await loadSessions();

  setMessage(
    editingId
      ? "✅ Session updated"
      : "✅ Session created"
  );

  setTimeout(() => setMessage(""), 3000);
}

function startEditSession(session: Session) {
  setEditingId(session.Id);
  setName(session.Name);
  setSessionDate(session.SessionDate.slice(0, 10));
  setTheme(session.Theme || "");
  setStatus(session.Status || "planned");
}

async function deleteSession(id: number) {
  const confirmed = window.confirm(
    "Are you sure you want to delete this session? This cannot be undone."
  );

  if (!confirmed) return;

  const res = await fetch(`${API_URL}/api/sessions/${id}`, {
    method: "DELETE"
  });

  if (!res.ok) {
    alert(`Failed to delete session: ${res.statusText}`);
    return;
  }

  await loadSessions();

  setMessage("🗑️ Session deleted");
  setTimeout(() => setMessage(""), 3000);
}

useEffect(() => {
  void loadSessions();
}, [loadSessions]);

return (
  <>
    {message && (
      <div
        style={{
          background: "#e8f5e9",
          border: "1px solid #4caf50",
          padding: "0.75rem",
          borderRadius: "8px",
          marginBottom: "1rem"
        }}
      >
        {message}
      </div>
    )}

    <h2>{editingId ? "Edit Session" : "Create Session"}</h2>

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

    <select
      value={status}
      onChange={e => setStatus(e.target.value)}
    >
      <option value="planned">Planned</option>
      <option value="active">Active</option>
      <option value="completed">Completed</option>
    </select>

    <button type="submit">

  {editingId ? "Save Changes" : "Create Session"}
</button>

{editingId && (
  <button
    type="button"
    onClick={() => {
      setEditingId(null);
      setName("");
      setSessionDate("");
      setTheme("");
    }}
  >
    Cancel Edit
  </button>
)}
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

<small>
    {session.Status === "planned" && "🟡 Planned"}
    {session.Status === "active" && "🟢 Active"}
    {session.Status === "completed" && "⚫ Completed"}
  </small>

<br />

<button
  type="button"
  onClick={() => startEditSession(session)}
  style={{
    marginTop: "0.75rem",
    padding: "0.5rem",
    marginRight: "0.5rem"
  }}
>
  Edit Session
</button>


<Link to={`/sessions/${session.Id}/results`}>
  <button
    type="button"
    style={{
      marginTop: "0.75rem",
      padding: "0.5rem",
      marginRight: "0.5rem"
    }}
  >
    View Results
  </button>
</Link>


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
  const navigate = useNavigate();

  const [whiskies, setWhiskies] = useState<Whisky[]>([]);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [distillery, setDistillery] = useState("");
  const [region, setRegion] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [abv, setAbv] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [editingWhiskyId, setEditingWhiskyId] = useState<number | null>(null);
  const [editingWhiskyName, setEditingWhiskyName] = useState("");
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

  const url = editingWhiskyId
    ? `${API_URL}/api/whiskies/${editingWhiskyId}`
    : `${API_URL}/api/whiskies`;

  const method = editingWhiskyId ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      distillery,
      region,
      ageYears: ageYears ? Number(ageYears) : null,
      abv: abv ? Number(abv) : null,
      price: price ? Number(price) : null, imageUrl
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to save whisky: ${res.status} ${errorText}`);
    return;
  }

  setName("");
  setDistillery("");
  setRegion("");
  setAgeYears("");
  setAbv("");
  setPrice("");
  setImageUrl("");
  setEditingWhiskyId(null);
  setEditingWhiskyName("");

  await loadWhiskies();
  setMessage(
  editingWhiskyId
    ? "✅ Whisky updated"
    : "✅ Whisky created"
);

setTimeout(() => setMessage(""), 3000);
}

function startEditWhisky(whisky: Whisky) {
  setEditingWhiskyId(whisky.Id);
  setEditingWhiskyName(whisky.Name);
  setImageUrl(whisky.ImageUrl || "");
  setName(whisky.Name);
  setDistillery(whisky.Distillery || "");
  setRegion(whisky.Region || "");
  setAgeYears(whisky.AgeYears?.toString() || "");
  setAbv(whisky.ABV?.toString() || "");
  setPrice(whisky.Price?.toString() || "");
}

  async function deleteWhisky(id: number) {
  if (!confirm("Delete this whisky and all related tasting entries?")) {
    return;
  }

  const res = await fetch(`${API_URL}/api/whiskies/${id}`, {
    method: "DELETE"
  });

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to delete whisky: ${res.status} ${errorText}`);
    return;
  }

  await loadWhiskies();
  setMessage("🗑️ Whisky deleted");
  setTimeout(() => setMessage(""), 3000);
}

  useEffect(() => {
    void loadWhiskies();
  }, [loadWhiskies]);

  return (
    <>
    {message && (
        <div
          style={{
            background: "#e8f5e9",
            border: "1px solid #4caf50",
            padding: "0.75rem",
            borderRadius: "8px",
            marginBottom: "1rem"
          }}
        >
          {message}
        </div>
      )}
      <h2>{editingWhiskyId ? "Edit Whisky" : "Add Whisky"}</h2>
        {editingWhiskyId && (
          <div
            style={{
              background: "#fff3cd",
              border: "1px solid #ffeeba",
              padding: "0.75rem",
              borderRadius: "8px",
              marginBottom: "1rem"
            }}
          >
            Editing whisky: <strong>{editingWhiskyName}</strong>
          </div>
        )}
      <form
        onSubmit={createWhisky}
        style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}
      >

       







        <label style={{ display: "grid", gap: "0.25rem" }}>
          Whisky name
          <input
            placeholder="Whisky name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem" }}>
          Distillery
          <input
            placeholder="Distillery"
            value={distillery}
            onChange={e => setDistillery(e.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem" }}>
          Region
          <input
            placeholder="Region"
            value={region}
            onChange={e => setRegion(e.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem" }}>
          Age
          <input
            placeholder="Age"
            type="number"
            value={ageYears}
            onChange={e => setAgeYears(e.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem" }}>
          ABV %
          <input
            placeholder="ABV"
            type="number"
            step="0.1"
            value={abv}
            onChange={e => setAbv(e.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem" }}>
          Price £
          <input
            placeholder="Price"
            type="number"
            step="0.01"
            value={price}
            onChange={e => setPrice(e.target.value)}
          />
        </label>


        <label style={{ display: "grid", gap: "0.25rem" }}>
          Image URL
          <input
            placeholder="https://example.com/bottle.jpg"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
          />
        </label>        

        <button type="submit">
  {editingWhiskyId ? "Save Changes" : "Add Whisky"}
</button>

      {editingWhiskyId && (
        <button
          type="button"
          onClick={() => {
            setEditingWhiskyId(null);
            setEditingWhiskyName("");

            setName("");
            setDistillery("");
            setRegion("");
            setAgeYears("");
            setAbv("");
            setPrice("");
            setImageUrl("");
          }}
        >
          Cancel Edit
        </button>
      )}
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center"
              }}
            >
              {whisky.ImageUrl && (
                <img
                  src={whisky.ImageUrl}
                  alt={whisky.Name}
                  style={{
                    display: "block",
                    width: "120px",
                    height: "160px",
                    objectFit: "cover",
                    borderRadius: "8px",
                    marginBottom: "0.75rem"
                  }}
                />
              )}

              <strong style={{ fontSize: "1.1rem" }}>
                {whisky.Name}
              </strong>

              <p>{whisky.Distillery}</p>
              <p>{whisky.Region}</p>

              <small>
                {whisky.AgeYears ? `${whisky.AgeYears} years ` : ""}
                {whisky.ABV ? `${whisky.ABV}% ` : ""}
                {whisky.Price ? `£${whisky.Price}` : ""}
              </small>
            </div>

            <br />

            <button
              type="button"
              onClick={() => startEditWhisky(whisky)}
            >
              Edit
            </button>

            <button
              type="button"
              onClick={() => deleteWhisky(whisky.Id)}
              style={{ marginLeft: "0.5rem" }}
            >
              Delete
            </button>

            <button
              type="button"
              onClick={() => navigate(`/whiskies/${whisky.Id}/stats`)}
              style={{ marginLeft: "0.5rem" }}
            >
              View Stats
            </button>
          </div>
        ))}
    </>
  );
}

function SessionDetailPage() {
  const { id } = useParams();

  const [session, setSession] = useState<Session | null>(null);

  const [entries, setEntries] = useState<TastingEntry[]>([]);
  const [message, setMessage] = useState("");
  const [whiskies, setWhiskies] = useState<Whisky[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState("");
  const [whiskyId, setWhiskyId] = useState("");
  const [noseNotes, setNoseNotes] = useState("");
  const [palateNotes, setPalateNotes] = useState("");
  const [finishNotes, setFinishNotes] = useState("");
  const [noseScore, setNoseScore] = useState("");
  const [palateScore, setPalateScore] = useState("");
  const [finishScore, setFinishScore] = useState("");
  const [overallScore, setOverallScore] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editingEntryName, setEditingEntryName] = useState("");
  const [summary, setSummary] = useState<SessionSummary[]>([]);
  


  const loadSession = useCallback(async () => {
  if (!id) return;

  const res = await fetch(`${API_URL}/api/sessions`);

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to load session: ${res.status} ${errorText}`);
    return;
  }

  const data: Session[] = await res.json();
  const currentSession = data.find(s => s.Id === Number(id));

  setSession(currentSession || null);
}, [id]);

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

  const loadMembers = useCallback(async () => {
  const res = await fetch(`${API_URL}/api/members`);

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to load members: ${res.status} ${errorText}`);
    return;
  }

  const data = await res.json();
  setMembers(data);
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


async function deleteTastingEntry(id: number) {
  if (!confirm("Delete this tasting entry?")) {
    return;
  }

  const res = await fetch(`${API_URL}/api/tasting-entries/${id}`, {
    method: "DELETE"
  });

  if (!res.ok) {
    const errorText = await res.text();
    alert(`Failed to delete tasting entry: ${res.status} ${errorText}`);
    return;
  }

  await loadTastingEntries();
  await loadSessionSummary();
  setMessage("🗑️ Tasting entry deleted");
  setTimeout(() => setMessage(""), 3000);
  }

function startEditEntry(entry: TastingEntry) {
  setEditingEntryId(entry.Id);
  setEditingEntryName(entry.WhiskyName);
  setMemberId(entry.ClubMemberId?.toString() || "");
  setNoseNotes(entry.NoseNotes || "");
  setPalateNotes(entry.PalateNotes || "");
  setFinishNotes(entry.FinishNotes || "");
  setMemberId(entry.ClubMemberId?.toString() || "");
  setNoseScore(entry.NoseScore?.toString() || "");
  setPalateScore(entry.PalateScore?.toString() || "");
  setFinishScore(entry.FinishScore?.toString() || "");
  setOverallScore(entry.OverallScore?.toString() || "");
}
  async function createTastingEntry(e: React.FormEvent) {
    e.preventDefault();

    if (!id) {
      alert("No session ID found.");
      return;
    }

    
    const url = editingEntryId
      ? `${API_URL}/api/tasting-entries/${editingEntryId}`
      : `${API_URL}/api/tasting-entries`;

    const method = editingEntryId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tastingSessionId: Number(id),
        whiskyId: Number(whiskyId),
        clubMemberId: memberId ? Number(memberId) : null,
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
    setMemberId("");
    setNoseNotes("");
    setPalateNotes("");
    setFinishNotes("");
    setNoseScore("");
    setPalateScore("");
    setFinishScore("");
    setOverallScore("");

    setEditingEntryId(null);
    setEditingEntryName("");

    await loadTastingEntries();
    await loadSessionSummary();
    setMessage(
  editingEntryId
    ? "✅ Tasting entry updated"
    : "✅ Tasting entry saved"
);

setTimeout(() => setMessage(""), 3000);

  }

useEffect(() => {
  void loadSession();
  void loadWhiskies();
  void loadMembers();
  void loadTastingEntries();
  void loadSessionSummary();
}, [
  loadSession,
  loadWhiskies,
  loadMembers,
  loadTastingEntries,
  loadSessionSummary
]);
const isCompleted = session?.Status === "completed";

return (
  <>
    {isCompleted && (
      <div
        style={{
          background: "#f5f5f5",
          border: "1px solid #999",
          padding: "0.75rem",
          borderRadius: "8px",
          marginBottom: "1rem"
        }}
      >
        🔒 This session is completed and is read-only.
      </div>
    )}
    {message && (
        <div
          style={{
            background: "#e8f5e9",
            border: "1px solid #4caf50",
            padding: "0.75rem",
            borderRadius: "8px",
            marginBottom: "1rem"
          }}
        >
          {message}
        </div>
      )}
      <h2>
        {editingEntryId ? "Edit Tasting Entry" : "Add Tasting Entry"}
        {isCompleted && (
  <div
    style={{
      background: "#f5f5f5",
      border: "1px solid #999",
      padding: "0.75rem",
      borderRadius: "8px",
      marginBottom: "1rem"
    }}
  >
    🔒 This session is completed and is read-only.
  </div>
)}
      </h2>
      {editingEntryId && (
        <div
          style={{
            background: "#fff3cd",
            border: "1px solid #ffeeba",
            padding: "0.75rem",
            borderRadius: "8px",
            marginBottom: "1rem"
          }}
        >
          Editing tasting notes for: <strong>{editingEntryName}</strong>Editing: <strong>{editingEntryName}</strong>
        </div>
      )}
      {!isCompleted && (
      <form
        onSubmit={createTastingEntry}
        style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}
      >

        <label style={{ display: "grid", gap: "0.25rem" }}>
          Club Member

          <select
            value={memberId}
            onChange={e => setMemberId(e.target.value)}
            required
          >
            <option value="">Select member</option>

              {members
              .filter(member => member.IsActive)
              .map(member => (
                <option key={member.Id} value={member.Id}>
                  {member.Name}
             </option>
          ))}



          </select>
        </label>

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

        <input type="number" min="0" max="10" step="0.5" placeholder="Nose score" value={noseScore} onChange={e => setNoseScore(e.target.value)} />
        <input type="number" min="0" max="10" step="0.5" placeholder="Palate score" value={palateScore} onChange={e => setPalateScore(e.target.value)} />
        <input type="number" min="0" max="10" step="0.5" placeholder="Finish score" value={finishScore} onChange={e => setFinishScore(e.target.value)} />
        <input type="number" min="0" max="10" step="0.5" placeholder="Overall score" value={overallScore} onChange={e => setOverallScore(e.target.value)} />

        <button type="submit">
  {editingEntryId ? "Save Changes" : "Save Tasting Entry"}
        </button>

        {editingEntryId && (
          <button
            type="button"
            onClick={() => {
              setEditingEntryId(null);
              setEditingEntryName("");

              setWhiskyId("");
              setNoseNotes("");
              setPalateNotes("");
              setFinishNotes("");

              setNoseScore("");
              setPalateScore("");
              setFinishScore("");
              setOverallScore("");
            }}
            style={{
              marginLeft: "0.5rem"
            }}
          >
            Cancel Edit
          </button>
        )}
      </form>

)}
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
          <div>
          👤 👤 {entry.MemberName || "No member recorded"}
          </div>
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
          {!isCompleted && (
  <>
          <button
            type="button"
            onClick={() => startEditEntry(entry)}
            style={{
              marginTop: "0.75rem",
              padding: "0.5rem",
              marginRight: "0.5rem"
            }}
          >
            Edit Entry
          </button>

  </>
)}
          {!isCompleted && (
  <>
          <button
            type="button"
            onClick={() => deleteTastingEntry(entry.Id)}
            style={{
              marginTop: "0.75rem",
              padding: "0.5rem"
            }}
          >
            Delete Entry
          </button>
  </>
)}          
        </div>
      ))}

      <Link to="/sessions">Back to Sessions</Link>
    </>
  );
}

function SessionResultsPage() {
  const { id } = useParams();
  const [summary, setSummary] = useState<SessionSummary[]>([]);

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

  useEffect(() => {
    void loadSessionSummary();
  }, [loadSessionSummary]);


  function exportResultsPdf() {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text("Whisky Club - Session Results", 14, 20);

  doc.setFontSize(11);
  doc.text(`Session ID: ${id}`, 14, 30);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 37);

  autoTable(doc, {
    startY: 50,
    head: [["Position", "Whisky", "Average Score", "Entries"]],
    body: summary.map((item, index) => [
      String(index + 1),
      item.WhiskyName,
      Number(item.AverageScore).toFixed(1),
      String(item.EntryCount)
    ])
  });

  doc.save(`session-${id}-results.pdf`);
}



  return (
    <>
     <h2>🏆 Session Results</h2><h2>Session Results</h2>

        <div
          style={{
            background: "#f5f5f5",
            border: "1px solid #999",
            padding: "0.75rem",
            borderRadius: "8px",
            marginBottom: "1rem"
          }}
        >
          🔒 This session is completed and is read-only.
        </div>




     <button
        type="button"
        onClick={exportResultsPdf}
        disabled={summary.length === 0}
        style={{
          marginBottom: "1rem",
          padding: "0.5rem"
        }}
      >
        Export PDF
      </button>
      {summary.length > 0 && (
        <div
          style={{
            background: "#fff3cd",
            border: "1px solid #ffeeba",
            padding: "1rem",
            borderRadius: "12px",
            marginBottom: "1rem"
          }}
        >
          <strong>
            Winner: {summary[0].WhiskyName}
          </strong>

          <div>
            Score: {Number(summary[0].AverageScore).toFixed(1)}
          </div>
        </div>
      )}
      {summary.length === 0 ? (
        <p>No scored entries yet.</p>
      ) : (
        summary.map((item, index) => (
          <div
            key={item.WhiskyName}
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "1rem",
              marginBottom: "1rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#fff"
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "1.2rem",
                  fontWeight: "bold"
                }}
              >
                {index === 0 && "🥇 "}
                {index === 1 && "🥈 "}
                {index === 2 && "🥉 "}
                {item.WhiskyName}
              </div>

              <small>
                {item.EntryCount} tasting
                {item.EntryCount === 1 ? "" : "s"}
              </small>
            </div>

            <div
              style={{
                fontSize: "2rem",
                fontWeight: "bold"
              }}
            >
              {Number(item.AverageScore).toFixed(1)}
            </div>
          </div>
        ))
      )}

      <Link to={`/sessions/${id}`}>Back to Session</Link>
    </>
  );
}

function WhiskyStatsPage() {
  const { id } = useParams();
  const [stats, setStats] = useState<WhiskyStats | null>(null);

  const loadStats = useCallback(async () => {
    if (!id) return;

    const res = await fetch(`${API_URL}/api/whiskies/${id}/stats`);

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to load stats: ${res.status} ${errorText}`);
      return;
    }

    const data = await res.json();
    setStats(data);
  }, [id]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  if (!stats) {
    return <p>Loading...</p>;
  }

  return (
    <main style={{ padding: "1rem" }}>
      <h1>{stats.Name}</h1>

      <p><strong>Distillery:</strong> {stats.Distillery}</p>
      <p><strong>Region:</strong> {stats.Region}</p>

      <hr />

      <p><strong>Times Tasted:</strong> {stats.TimesTasted}</p>

      <p>
        <strong>Average Score:</strong>{" "}
        {stats.AverageOverallScore
          ? Number(stats.AverageOverallScore).toFixed(1)
          : "-"}
      </p>

      <p>
        <strong>Best Score:</strong>{" "}
        {stats.BestScore ?? "-"}
      </p>

      <p>
        <strong>Worst Score:</strong>{" "}
        {stats.WorstScore ?? "-"}
      </p>

      <Link to="/whiskies">Back to Whiskies</Link>
    </main>
  );
}

function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  const loadDashboard = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/dashboard`);

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to load dashboard: ${res.status} ${errorText}`);
      return;
    }

    const data = await res.json();
    setDashboard(data);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (!dashboard) {
    return <p>Loading dashboard...</p>;
  }

  return (
    <>
      <h2>Dashboard</h2>

      <div style={{ display: "grid", gap: "1rem", marginBottom: "2rem" }}>
        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>📅 Sessions</strong>
          <p>{dashboard.SessionCount}</p>
        </div>

        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>🥃 Whiskies</strong>
          <p>{dashboard.WhiskyCount}</p>
        </div>

        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>👥 Active Members</strong>
          <p>{dashboard.ActiveMemberCount}</p>
        </div>

        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>📝 Tasting Entries</strong>
          <p>{dashboard.TastingEntryCount}</p>
        </div>

        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>⭐ Average Club Score</strong>
          <p>
            {dashboard.AverageOverallScore
              ? Number(dashboard.AverageOverallScore).toFixed(1)
              : "-"}
          </p>
        </div>

        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>🏆 Top Whisky</strong>
          {dashboard.TopWhisky ? (
            <p>
              {dashboard.TopWhisky.WhiskyName} —{" "}
              {Number(dashboard.TopWhisky.AverageScore).toFixed(1)}
            </p>
          ) : (
            <p>-</p>
          )}
        </div>

        <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
          <strong>🔥 Most Active Member</strong>
          {dashboard.MostActiveMember ? (
            <p>
              {dashboard.MostActiveMember.MemberName} —{" "}
              {dashboard.MostActiveMember.TastingCount} tastings
            </p>
          ) : (
            <p>-</p>
          )}
        </div>
      </div>

      <h2>Recent Sessions</h2>

      {dashboard.RecentSessions.map(session => (
        <div
          key={session.Id}
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "8px"
          }}
        >
          <strong>{session.Name}</strong>
          <p>{new Date(session.SessionDate).toLocaleDateString()}</p>
          <p>{session.Theme}</p>
          <small>{session.Status}</small>
        </div>
      ))}
    </>
  );
}

function MembersPage() {
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  

  const loadMembers = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/members`);
    const data = await res.json();
    setMembers(data);
  }, []);


async function toggleMemberStatus(member: Member) {
  const action = member.IsActive
    ? "deactivate"
    : "reactivate";

  const confirmed = window.confirm(
    `Are you sure you want to ${action} ${member.Name}?`
  );

  if (!confirmed) return;

  const res = await fetch(
    `${API_URL}/api/members/${member.Id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: member.Name,
        email: member.Email,
        isActive: !member.IsActive
      })
    }
  );

  if (!res.ok) {
    const errorText = await res.text();

    alert(
      `Failed to ${action} member: ${res.status} ${errorText}`
    );

    return;
  }

  await loadMembers();
}



  async function saveMember(e: React.FormEvent) {
    e.preventDefault();

    const url = editingMemberId
      ? `${API_URL}/api/members/${editingMemberId}`
      : `${API_URL}/api/members`;

    const method = editingMemberId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, isActive: true })
    });

    if (!res.ok) {
      alert(`Failed to save member: ${res.status}`);
      return;
    }

    setName("");
    setEmail("");
    setEditingMemberId(null);
    await loadMembers();
  }



  function startEditMember(member: Member) {
    setEditingMemberId(member.Id);
    setName(member.Name);
    setEmail(member.Email || "");
  }

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  return (
    <>
      <h2>{editingMemberId ? "Edit Member" : "Add Member"}</h2>

      <form onSubmit={saveMember} style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}>
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} required />
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />

        <button type="submit">
          {editingMemberId ? "Save Changes" : "Add Member"}
        </button>
      </form>

      <h2>Members</h2>

      {members.map(member => (
        <div
          key={member.Id}
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "8px"
          }}
        >
          <strong>
            {member.Name}
            {!member.IsActive && " (Inactive)"}
          </strong>

          <p>{member.Email}</p>

          <button
              type="button"
              onClick={() => startEditMember(member)}
            >
              Edit
            </button>

            <button
              type="button"
              onClick={() => toggleMemberStatus(member)}
              style={{ marginLeft: "0.5rem" }}
            >
              {member.IsActive ? "Deactivate" : "Reactivate"}
            </button>

            <button
              type="button"
              onClick={() => navigate(`/members/${member.Id}/stats`)}
              style={{ marginLeft: "0.5rem" }}
            >
              View Stats
          </button>
        </div>
))}
    </>
  );
}

function MemberStatsPage() {
  const { id } = useParams();
  const [stats, setStats] = useState<MemberStats | null>(null);

  const loadMemberStats = useCallback(async () => {
    if (!id) return;

    const res = await fetch(`${API_URL}/api/members/${id}/stats`);

    if (!res.ok) {
      const errorText = await res.text();
      alert(`Failed to load member stats: ${res.status} ${errorText}`);
      return;
    }

    const data = await res.json();
    setStats(data);
  }, [id]);

  useEffect(() => {
    void loadMemberStats();
  }, [loadMemberStats]);

  if (!stats) {
    return <p>Loading member stats...</p>;
  }

  return (
    <>
      <h2>👤 Member Stats</h2>

      <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
        <h3>{stats.Name}</h3>
        <p>{stats.Email || ""}</p>
        <p>{stats.IsActive ? "🟢 Active" : "⚫ Inactive"}</p>
      </div>

      <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
        <p><strong>Tastings submitted:</strong> {stats.TastingsSubmitted}</p>
        <p><strong>Average score given:</strong> {stats.AverageScoreGiven ? Number(stats.AverageScoreGiven).toFixed(1) : "-"}</p>
        <p><strong>Highest score given:</strong> {stats.HighestScoreGiven ?? "-"}</p>
        <p><strong>Lowest score given:</strong> {stats.LowestScoreGiven ?? "-"}</p>
      </div>

      <div style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
        <h3>Favourite Whisky</h3>
        {stats.FavouriteWhisky ? (
          <p>
            {stats.FavouriteWhisky.WhiskyName} — {Number(stats.FavouriteWhisky.OverallScore).toFixed(1)}
          </p>
        ) : (
          <p>No favourite yet.</p>
        )}
      </div>

      <Link to="/members">Back to Members</Link>
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

      <nav
        style={{
          position: "sticky",
          bottom: 0,
          background: "white",
          borderTop: "1px solid #ccc",
          padding: "0.75rem",
          display: "flex",
          justifyContent: "space-around",
          marginBottom: "1rem",
          zIndex: 10
        }}
      >
        <Link to="/">Dashboard</Link>
        <Link to="/sessions">Sessions</Link>
        <Link to="/whiskies">Whiskies</Link>
        <Link to="/members">Members</Link>
      </nav>

      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/whiskies" element={<WhiskiesPage />} />
        <Route path="/whiskies/:id/stats" element={<WhiskyStatsPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/sessions/:id/results" element={<SessionResultsPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/members/:id/stats" element={<MemberStatsPage />} />
      </Routes>

    </main>
  );
}

export default App;