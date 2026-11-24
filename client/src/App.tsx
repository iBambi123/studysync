import { Chat } from "./components/Chat";
import { Lobby } from "./components/Lobby";
import { Members } from "./components/Members";
import { Quiz } from "./components/Quiz";
import { Timer } from "./components/Timer";
import { useRoom } from "./useRoom";

export default function App() {
  const api = useRoom();
  const room = api.room;

  if (!room) return <Lobby api={api} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Study<span>Sync</span>
        </h1>
        <div className="topbar__room">
          Room <code>{room.code}</code>
        </div>
        <div className="topbar__right">
          {api.status !== "connected" && <span className="pill pill--warn">Reconnecting…</span>}
          <button className="btn btn--ghost" onClick={api.leave}>
            Leave
          </button>
        </div>
      </header>

      {api.error && (
        <div className="toast" role="alert">
          {api.error}
          <button aria-label="Dismiss" onClick={() => api.setError(null)}>
            ✕
          </button>
        </div>
      )}

      <main className="grid">
        <div className="col">
          <Timer api={api} />
          <Members api={api} />
        </div>
        <div className="col col--wide">
          <Quiz api={api} />
          <Chat api={api} />
        </div>
      </main>
    </div>
  );
}
