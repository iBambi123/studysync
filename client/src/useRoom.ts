// All realtime state lives here: the socket connection, the latest room
// snapshot from the server, and helpers to send actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from "../../shared/types";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckResult<T> = { ok: true; data?: T } | { ok: false; error: string };

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

// Same origin in production; Vite proxies /socket.io to the server in development.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? undefined;

export function useRoom() {
  const socket = useMemo<AppSocket>(() => io(SERVER_URL, { autoConnect: false }), []);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Server clock minus our clock, so timers agree across devices. */
  const [clockOffset, setClockOffset] = useState(0);
  /** Remembered so we can rejoin automatically after a dropped connection. */
  const session = useRef<{ code: string; name: string } | null>(null);

  useEffect(() => {
    const onConnect = () => {
      setStatus("connected");
      const saved = session.current;
      if (saved) {
        socket.emit("room:join", saved, (res) => {
          if (res.ok && res.data) {
            setMemberId(res.data.memberId);
          } else {
            session.current = null;
            setRoom(null);
            setError("You were disconnected and the room closed. Create or join a new one.");
          }
        });
      }
    };
    const onDisconnect = () => setStatus("reconnecting");
    const onState = (snapshot: RoomSnapshot) => {
      setClockOffset(snapshot.serverNow - Date.now());
      setRoom(snapshot);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.disconnect();
    };
  }, [socket]);

  const enter = useCallback(
    async (kind: "create" | "join", name: string, code = ""): Promise<boolean> => {
      setError(null);
      const res: AckResult<{ code: string; memberId: string }> =
        kind === "create"
          ? await socket.emitWithAck("room:create", { name })
          : await socket.emitWithAck("room:join", { code, name });
      if (!res.ok || !res.data) {
        setError(res.ok ? "Something went wrong" : res.error);
        return false;
      }
      session.current = { code: res.data.code, name: name.trim() };
      setMemberId(res.data.memberId);
      return true;
    },
    [socket],
  );

  const leave = useCallback(() => {
    socket.emit("room:leave");
    session.current = null;
    setRoom(null);
    setMemberId(null);
  }, [socket]);

  /** Sends an event that replies with an ack, and surfaces any error. */
  const request = useCallback(async <T>(send: () => Promise<AckResult<T>>): Promise<AckResult<T>> => {
    const res = await send();
    setError(res.ok ? null : res.error);
    return res;
  }, []);

  return {
    socket,
    status,
    room,
    memberId,
    isHost: !!room && room.hostId === memberId,
    clockOffset,
    error,
    setError,
    enter,
    leave,
    request,
  };
}

export type RoomApi = ReturnType<typeof useRoom>;
