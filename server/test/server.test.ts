// End-to-end test: real Socket.IO clients talking to a real server on a random port.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import type { ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from "../../shared/types.js";
import { createStudySyncServer } from "../src/app.js";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = "";
const server = createStudySyncServer({ tickMs: 50 });
const clients: ClientSocket[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  server.io.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
});

async function client(): Promise<ClientSocket> {
  const socket: ClientSocket = connect(url, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  return socket;
}

/** Resolves with the next room state that passes the check. */
function nextState(socket: ClientSocket, check: (s: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
  return new Promise((resolve) => {
    const listener = (s: RoomSnapshot) => {
      if (check(s)) {
        socket.off("room:state", listener);
        resolve(s);
      }
    };
    socket.on("room:state", listener);
  });
}

describe("StudySync server", () => {
  it("answers health checks", async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("syncs members, timer and chat between two clients", async () => {
    const alice = await client();
    const bob = await client();

    const created = await alice.emitWithAck("room:create", { name: "Alice" });
    expect(created.ok).toBe(true);
    const code = created.ok ? created.data!.code : "";

    const aliceSeesBob = nextState(alice, (s) => s.members.length === 2);
    const joined = await bob.emitWithAck("room:join", { code, name: "Bob" });
    expect(joined.ok).toBe(true);
    expect((await aliceSeesBob).members.map((m) => m.name)).toEqual(["Alice", "Bob"]);

    const bobSeesTimer = nextState(bob, (s) => s.timer.running);
    alice.emit("timer:start");
    const timerState = await bobSeesTimer;
    expect(timerState.timer.endsAt).toBeGreaterThan(timerState.serverNow);

    const aliceSeesChat = nextState(alice, (s) => s.chat.some((m) => m.text === "hi!"));
    bob.emit("chat:send", { text: "hi!" });
    expect((await aliceSeesChat).chat.at(-1)?.name).toBe("Bob");
  });

  it("returns readable errors through acknowledgements", async () => {
    const carol = await client();
    const bad = await carol.emitWithAck("room:join", { code: "QQQQ", name: "Carol" });
    expect(bad).toEqual({ ok: false, error: "Room not found. Check the code and try again" });
  });

  it("runs a quiz without leaking the answer early", async () => {
    const host = await client();
    const guest = await client();
    const created = await host.emitWithAck("room:create", { name: "Host" });
    const code = created.ok ? created.data!.code : "";
    await guest.emitWithAck("room:join", { code, name: "Guest" });

    await host.emitWithAck("quiz:addCard", { question: "2 + 2?", answer: "4" });
    const notHost = await guest.emitWithAck("quiz:addCard", { question: "x", answer: "y" });
    expect(notHost).toEqual({ ok: false, error: "Only the host can do that" });

    const guestSeesQuestion = nextState(guest, (s) => s.quiz.phase === "question");
    await host.emitWithAck("quiz:start");
    const question = await guestSeesQuestion;
    expect(question.quiz.question).toBe("2 + 2?");
    expect(question.quiz.answer).toBeNull();

    const result = await guest.emitWithAck("quiz:answer", { answer: " 4 " });
    expect(result).toEqual({ ok: true, data: { correct: true } });

    const revealed = nextState(guest, (s) => s.quiz.phase === "reveal");
    host.emit("quiz:reveal");
    const state = await revealed;
    expect(state.quiz.answer).toBe("4");
    expect(state.members.find((m) => m.name === "Guest")?.score).toBe(1);
  });

  it("passes the host role on when the host disconnects", async () => {
    const first = await client();
    const second = await client();
    const created = await first.emitWithAck("room:create", { name: "First" });
    const code = created.ok ? created.data!.code : "";
    await second.emitWithAck("room:join", { code, name: "Second" });

    const promoted = nextState(second, (s) => s.members.length === 1);
    first.disconnect();
    const state = await promoted;
    expect(state.hostId).toBe(second.id);
  });
});
