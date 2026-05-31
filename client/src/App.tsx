import { useEffect, useState } from "react";

type Session = {
  Id: number;
  Name: string;
  SessionDate: string;
  Theme?: string;
  Status: string;
};

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    fetch("https://whiskyclub-web-akc8dgc8dtfndugm.ukwest-01.azurewebsites.net/api/sessions")
      .then(res => res.json())
      .then(data => setSessions(data));
  }, []);

  return (
    <main style={{ padding: "1rem", fontFamily: "Arial" }}>
      <h1>Whisky Club</h1>
      <h2>Tasting Sessions</h2>

      {sessions.length === 0 ? (
        <p>No sessions yet.</p>
      ) : (
        sessions.map(session => (
          <div key={session.Id} style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
            <strong>{session.Name}</strong>
            <p>{session.SessionDate}</p>
            <p>{session.Theme}</p>
          </div>
        ))
      )}
    </main>
  );
}

export default App;