import { useEffect, useState, type FormEvent } from "react";
import type { TimerState } from "../../../shared/types";
import type { RoomApi } from "../useRoom";

export function remainingMs(timer: TimerState, clockOffset: number, now = Date.now()): number {
  if (!timer.running || timer.endsAt === null) return timer.remainingMs;
  return Math.max(0, timer.endsAt - (now + clockOffset));
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Timer({ api }: { api: RoomApi }) {
  const timer = api.room!.timer;
  const [, setFrame] = useState(0);
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState(timer.focusMinutes);
  const [rest, setRest] = useState(timer.breakMinutes);

  // Re-render a few times a second while running so the clock counts down smoothly.
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setFrame((f) => f + 1), 250);
    return () => clearInterval(id);
  }, [timer.running]);

  const left = remainingMs(timer, api.clockOffset);
  const total = (timer.mode === "focus" ? timer.focusMinutes : timer.breakMinutes) * 60_000;
  const progress = total > 0 ? 1 - left / total : 0;

  useEffect(() => {
    document.title = timer.running ? `${formatClock(left)} · ${timer.mode} · StudySync` : "StudySync";
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    const res = await api.request(() =>
      api.socket.emitWithAck("timer:configure", { focusMinutes: focus, breakMinutes: rest }),
    );
    if (res.ok) setEditing(false);
  }

  return (
    <section className={`card timer timer--${timer.mode}`}>
      <div className="card__title">
        <h2>{timer.mode === "focus" ? "Focus" : "Break"}</h2>
        <span className="pill">{timer.completedSessions} sessions done</span>
      </div>

      <div className="timer__clock" aria-live="polite">
        {formatClock(left)}
      </div>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
        <div style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>

      <div className="row">
        {timer.running ? (
          <button className="btn" onClick={() => api.socket.emit("timer:pause")}>
            Pause
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => api.socket.emit("timer:start")}>
            Start
          </button>
        )}
        <button className="btn btn--ghost" onClick={() => api.socket.emit("timer:reset")}>
          Reset
        </button>
        <button
          className="btn btn--ghost"
          aria-label="Change timer lengths"
          onClick={() => {
            setFocus(timer.focusMinutes);
            setRest(timer.breakMinutes);
            setEditing((v) => !v);
          }}
        >
          {timer.focusMinutes}/{timer.breakMinutes} min
        </button>
      </div>

      {editing && (
        <form className="row timer__settings" onSubmit={save}>
          <label>
            Focus
            <input
              type="number"
              min={1}
              max={120}
              value={focus}
              onChange={(e) => setFocus(Number(e.target.value))}
            />
          </label>
          <label>
            Break
            <input
              type="number"
              min={1}
              max={120}
              value={rest}
              onChange={(e) => setRest(Number(e.target.value))}
            />
          </label>
          <button className="btn">Save</button>
        </form>
      )}
      <p className="muted small">Everyone in the room shares this timer.</p>
    </section>
  );
}
