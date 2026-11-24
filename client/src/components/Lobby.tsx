import { useState, type FormEvent } from "react";
import type { RoomApi } from "../useRoom";

function loadName(): string {
  try {
    return localStorage.getItem("studysync:name") ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem("studysync:name", name);
  } catch {
    // Storage can be unavailable (private mode); the name just won't be remembered.
  }
}

export function Lobby({ api }: { api: RoomApi }) {
  const invited = new URLSearchParams(window.location.search).get("room") ?? "";
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(invited.toUpperCase());
  const [busy, setBusy] = useState(false);

  async function go(kind: "create" | "join", event?: FormEvent) {
    event?.preventDefault();
    if (!name.trim()) {
      api.setError("Enter your name first");
      return;
    }
    setBusy(true);
    saveName(name.trim());
    await api.enter(kind, name, code);
    setBusy(false);
  }

  return (
    <main className="lobby">
      <header className="lobby__hero">
        <h1>
          Study<span>Sync</span>
        </h1>
        <p>Study together in real time: a shared focus timer, room chat, and live flashcard quizzes.</p>
      </header>

      <section className="card lobby__form">
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="e.g. Ced"
            autoFocus
          />
        </label>

        <button
          className="btn btn--primary"
          disabled={busy || api.status !== "connected"}
          onClick={() => go("create")}
        >
          Create a new room
        </button>

        <div className="divider">or join one</div>

        <form className="row" onSubmit={(e) => go("join", e)}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder="Room code"
            aria-label="Room code"
            className="code-input"
          />
          <button className="btn" disabled={busy || code.length !== 4 || api.status !== "connected"}>
            Join
          </button>
        </form>

        {api.status !== "connected" && <p className="muted">Connecting to the server…</p>}
        {api.error && <p className="error">{api.error}</p>}
      </section>
    </main>
  );
}
