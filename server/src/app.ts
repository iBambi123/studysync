// HTTP + Socket.IO server. Wires socket events to the pure room logic in rooms.ts.
// index.ts starts it; tests create their own instance.

import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import type { Ack, ClientToServerEvents, ServerToClientEvents } from "../../shared/types.js";
import { RoomError, RoomManager, type Room } from "./rooms.js";

export interface ServerOptions {
  clientOrigin?: string;
  /** How often the server checks timers, in ms. */
  tickMs?: number;
}

/** Builds the HTTP + Socket.IO server without starting it (handy for tests). */
export function createStudySyncServer({
  clientOrigin = "http://localhost:5173",
  tickMs = 1000,
}: ServerOptions = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: clientOrigin },
  });
  const rooms = new RoomManager();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", rooms: rooms.roomCount, uptimeSeconds: Math.round(process.uptime()) });
  });

  // In production the server also serves the built React app.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = [
    path.resolve(here, "../../client/dist"), // running with tsx from server/src
    path.resolve(here, "../../../../client/dist"), // running compiled from server/dist/server/src
  ].find((dir) => existsSync(dir));
  if (clientDist) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!socket\.io|health).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  function broadcast(room: Room): void {
    io.to(room.code).emit("room:state", rooms.snapshot(room, Date.now()));
  }

  type AnyAck = Ack<any> | undefined;

  /**
   * Runs a room action for the socket's current room and broadcasts the result.
   * RoomErrors go back to the caller through the ack; anything else is logged.
   */
  function handle(socket: Socket, ack: AnyAck, action: (room: Room) => unknown): void {
    try {
      const room = rooms.roomOf(socket.id);
      if (!room) throw new RoomError("Join a room first");
      const data = action(room);
      broadcast(room);
      ack?.({ ok: true, data });
    } catch (err) {
      respondError(err, ack);
    }
  }

  function respondError(err: unknown, ack: AnyAck): void {
    if (err instanceof RoomError) {
      ack?.({ ok: false, error: err.message });
    } else {
      console.error(err);
      ack?.({ ok: false, error: "Something went wrong" });
    }
  }

  function leaveCurrentRoom(socket: Socket): void {
    const room = rooms.leave(socket.id);
    if (!room) return;
    socket.leave(room.code);
    if (room.members.size > 0) broadcast(room);
  }

  io.on("connection", (socket) => {
    socket.on("room:create", ({ name }, ack) => {
      try {
        leaveCurrentRoom(socket);
        const room = rooms.createRoom(socket.id, name);
        socket.join(room.code);
        ack({ ok: true, data: { code: room.code, memberId: socket.id } });
        broadcast(room);
      } catch (err) {
        respondError(err, ack);
      }
    });

    socket.on("room:join", ({ code, name }, ack) => {
      try {
        const target = rooms.getRoom(String(code ?? "").trim());
        if (target && rooms.roomOf(socket.id) !== target) leaveCurrentRoom(socket);
        const room = rooms.joinRoom(socket.id, code, name);
        socket.join(room.code);
        ack({ ok: true, data: { code: room.code, memberId: socket.id } });
        broadcast(room);
      } catch (err) {
        respondError(err, ack);
      }
    });

    socket.on("room:leave", () => leaveCurrentRoom(socket));
    socket.on("disconnect", () => leaveCurrentRoom(socket));

    socket.on("timer:start", () => handle(socket, undefined, (room) => rooms.startTimer(room, Date.now())));
    socket.on("timer:pause", () => handle(socket, undefined, (room) => rooms.pauseTimer(room, Date.now())));
    socket.on("timer:reset", () => handle(socket, undefined, (room) => rooms.resetTimer(room)));
    socket.on("timer:configure", ({ focusMinutes, breakMinutes }, ack) =>
      handle(socket, ack, (room) => rooms.configureTimer(room, Number(focusMinutes), Number(breakMinutes))),
    );

    socket.on("chat:send", ({ text }, ack) =>
      handle(socket, ack, (room) => {
        rooms.sendChat(room, socket.id, text, Date.now());
      }),
    );

    socket.on("quiz:addCard", ({ question, answer }, ack) =>
      handle(socket, ack, (room) => {
        rooms.addCard(room, socket.id, question, answer);
      }),
    );
    socket.on("quiz:removeCard", ({ cardId }) =>
      handle(socket, undefined, (room) => rooms.removeCard(room, socket.id, String(cardId))),
    );
    socket.on("quiz:start", (ack) => handle(socket, ack, (room) => rooms.startQuiz(room, socket.id)));
    socket.on("quiz:answer", ({ answer }, ack) =>
      handle(socket, ack, (room) => ({ correct: rooms.submitAnswer(room, socket.id, answer) })),
    );
    socket.on("quiz:reveal", () => handle(socket, undefined, (room) => rooms.revealAnswer(room, socket.id)));
    socket.on("quiz:next", () => handle(socket, undefined, (room) => rooms.nextCard(room, socket.id)));
    socket.on("quiz:end", () => handle(socket, undefined, (room) => rooms.endQuiz(room, socket.id)));
  });

  // The server owns the timer: once a second, advance any phase that has ended
  // and tell that room. Clients only render what the server says.
  const ticker = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.allRooms()) {
      if (rooms.tick(room, now)) broadcast(room);
    }
  }, tickMs);
  httpServer.on("close", () => clearInterval(ticker));

  return { app, httpServer, io, rooms };
}
