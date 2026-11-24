import { useState } from "react";
import type { RoomApi } from "../useRoom";

export function Members({ api }: { api: RoomApi }) {
  const room = api.room!;
  const [copied, setCopied] = useState(false);
  const ranked = [...room.members].sort((a, b) => b.score - a.score);
  const showScores = room.quiz.phase !== "idle";

  async function copyInvite() {
    const link = `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  return (
    <section className="card">
      <div className="card__title">
        <h2>In this room</h2>
        <span className="pill">{room.members.length}</span>
      </div>
      <ul className="members">
        {(showScores ? ranked : room.members).map((m) => (
          <li key={m.id}>
            <span className="avatar" aria-hidden>
              {m.name.charAt(0).toUpperCase()}
            </span>
            <span className="members__name">
              {m.name}
              {m.id === api.memberId && <span className="muted"> (you)</span>}
            </span>
            {m.id === room.hostId && <span className="pill pill--host">host</span>}
            {showScores && <span className="score">{m.score}</span>}
          </li>
        ))}
      </ul>
      <button className="btn btn--ghost full" onClick={copyInvite}>
        {copied ? "Link copied!" : "Copy invite link"}
      </button>
    </section>
  );
}
