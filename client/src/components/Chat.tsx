import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RoomApi } from "../useRoom";

export function Chat({ api }: { api: RoomApi }) {
  const room = api.room!;
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [room.chat.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await api.request(() => api.socket.emitWithAck("chat:send", { text }));
    if (res.ok) setText("");
  }

  return (
    <section className="card chat">
      <div className="card__title">
        <h2>Chat</h2>
      </div>
      <ol className="chat__list" ref={listRef}>
        {room.chat.length === 0 && <li className="muted">No messages yet. Say hi!</li>}
        {room.chat.map((m) => (
          <li key={m.id} className={m.memberId === api.memberId ? "mine" : ""}>
            <span className="chat__name">{m.name}</span>
            <span className="chat__time">
              {new Date(m.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <p>{m.text}</p>
          </li>
        ))}
      </ol>
      <form className="row" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Message the room"
        />
        <button className="btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
