import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, RoomError, RoomManager, normalizeAnswer, publicQuiz } from "../src/rooms.js";

let rooms: RoomManager;

beforeEach(() => {
  rooms = new RoomManager();
});

describe("rooms", () => {
  it("creates a room with a 4-character code and makes the creator host", () => {
    const room = rooms.createRoom("a", "Ced");
    expect(room.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(room.hostId).toBe("a");
    expect([...room.members.values()].map((m) => m.name)).toEqual(["Ced"]);
  });

  it("joins case-insensitively and trims names", () => {
    const room = rooms.createRoom("a", "Ced");
    rooms.joinRoom("b", room.code.toLowerCase(), "  Sam   Lee ");
    expect(room.members.get("b")?.name).toBe("Sam Lee");
  });

  it("rejects unknown codes, empty names and long names", () => {
    const room = rooms.createRoom("a", "Ced");
    expect(() => rooms.joinRoom("b", "ZZZZ", "Sam")).toThrow(RoomError);
    expect(() => rooms.joinRoom("b", room.code, "   ")).toThrow(/Name is required/);
    expect(() => rooms.joinRoom("b", room.code, "x".repeat(LIMITS.nameLength + 1))).toThrow(RoomError);
  });

  it("caps room size", () => {
    const room = rooms.createRoom("host", "Host");
    for (let i = 1; i < LIMITS.roomSize; i++) rooms.joinRoom(`m${i}`, room.code, `M${i}`);
    expect(() => rooms.joinRoom("late", room.code, "Late")).toThrow(/full/);
  });

  it("hands the host role to the earliest remaining member", () => {
    const room = rooms.createRoom("a", "A");
    rooms.joinRoom("b", room.code, "B");
    rooms.joinRoom("c", room.code, "C");
    rooms.leave("a");
    expect(room.hostId).toBe("b");
  });

  it("deletes a room when the last member leaves", () => {
    const room = rooms.createRoom("a", "A");
    rooms.leave("a");
    expect(rooms.getRoom(room.code)).toBeUndefined();
    expect(rooms.roomCount).toBe(0);
  });

  it("moves a member out of their old room when they join another", () => {
    const first = rooms.createRoom("a", "A");
    const second = rooms.createRoom("b", "B");
    rooms.joinRoom("a", second.code, "A");
    expect(rooms.getRoom(first.code)).toBeUndefined();
    expect(rooms.roomOf("a")).toBe(second);
  });

  it("never reuses a code that is in use", () => {
    let calls = 0;
    // The first 8 draws are 0, so both rooms first try "AAAA"; the second must pick again.
    const seeded = new RoomManager(() => (calls++ < 8 ? 0 : (calls % 30) / 30));
    const a = seeded.createRoom("a", "A");
    const b = seeded.createRoom("b", "B");
    expect(a.code).toBe("AAAA");
    expect(b.code).not.toBe("AAAA");
  });
});

describe("timer", () => {
  const MIN = 60_000;

  it("starts, pauses and resumes from the same remaining time", () => {
    const room = rooms.createRoom("a", "A");
    rooms.startTimer(room, 0);
    expect(room.timer.endsAt).toBe(25 * MIN);
    rooms.pauseTimer(room, 10 * MIN);
    expect(room.timer.running).toBe(false);
    expect(room.timer.remainingMs).toBe(15 * MIN);
    rooms.startTimer(room, 100 * MIN);
    expect(room.timer.endsAt).toBe(115 * MIN);
  });

  it("switches from focus to break and counts the session", () => {
    const room = rooms.createRoom("a", "A");
    rooms.startTimer(room, 0);
    expect(rooms.tick(room, 25 * MIN - 1)).toBe(false);
    expect(rooms.tick(room, 25 * MIN)).toBe(true);
    expect(room.timer.mode).toBe("break");
    expect(room.timer.completedSessions).toBe(1);
    expect(room.timer.endsAt).toBe(30 * MIN);
  });

  it("catches up if several phases passed while the server was busy", () => {
    const room = rooms.createRoom("a", "A");
    rooms.startTimer(room, 0);
    // focus 0-25, break 25-30, focus 30-55, break 55-60: minute 58 is the 2nd break.
    rooms.tick(room, 58 * MIN);
    expect(room.timer.mode).toBe("break");
    expect(room.timer.completedSessions).toBe(2);
    expect(room.timer.endsAt).toBe(60 * MIN);
  });

  it("validates custom lengths and resets after configuring", () => {
    const room = rooms.createRoom("a", "A");
    expect(() => rooms.configureTimer(room, 0, 5)).toThrow(RoomError);
    expect(() => rooms.configureTimer(room, 25.5, 5)).toThrow(RoomError);
    rooms.startTimer(room, 0);
    rooms.configureTimer(room, 50, 10);
    expect(room.timer.running).toBe(false);
    expect(room.timer.remainingMs).toBe(50 * MIN);
  });

  it("keeps the session count after a reset", () => {
    const room = rooms.createRoom("a", "A");
    rooms.startTimer(room, 0);
    rooms.tick(room, 25 * MIN);
    rooms.resetTimer(room);
    expect(room.timer.mode).toBe("focus");
    expect(room.timer.completedSessions).toBe(1);
  });
});

describe("chat", () => {
  it("stores messages with the sender's name and trims history", () => {
    const room = rooms.createRoom("a", "Ced");
    for (let i = 0; i < LIMITS.chatHistory + 5; i++) rooms.sendChat(room, "a", `msg ${i}`, i);
    expect(room.chat).toHaveLength(LIMITS.chatHistory);
    expect(room.chat.at(-1)).toMatchObject({ name: "Ced", text: `msg ${LIMITS.chatHistory + 4}` });
  });

  it("rejects empty and oversized messages", () => {
    const room = rooms.createRoom("a", "Ced");
    expect(() => rooms.sendChat(room, "a", "   ", 0)).toThrow(RoomError);
    expect(() => rooms.sendChat(room, "a", "x".repeat(LIMITS.chatLength + 1), 0)).toThrow(RoomError);
  });
});

describe("quiz", () => {
  function setup() {
    const room = rooms.createRoom("host", "Host");
    rooms.joinRoom("sam", room.code, "Sam");
    rooms.addCard(room, "host", "What is the load factor?", "n / m");
    rooms.addCard(room, "host", "Expected chain length?", "alpha");
    return room;
  }

  it("only lets the host manage cards and run the quiz", () => {
    const room = setup();
    expect(() => rooms.addCard(room, "sam", "Q", "A")).toThrow(/Only the host/);
    expect(() => rooms.startQuiz(room, "sam")).toThrow(/Only the host/);
  });

  it("scores answers, ignoring case and punctuation, once per card", () => {
    const room = setup();
    rooms.startQuiz(room, "host");
    expect(rooms.submitAnswer(room, "sam", "N/M")).toBe(true);
    expect(rooms.submitAnswer(room, "host", "wrong")).toBe(false);
    expect(() => rooms.submitAnswer(room, "sam", "n / m")).toThrow(/already answered/);
    expect(room.members.get("sam")?.score).toBe(1);
    expect(room.members.get("host")?.score).toBe(0);
  });

  it("hides the answer until the host reveals it", () => {
    const room = setup();
    rooms.startQuiz(room, "host");
    expect(publicQuiz(room.quiz).answer).toBeNull();
    expect(JSON.stringify(rooms.snapshot(room, 0))).not.toContain("n / m");
    rooms.revealAnswer(room, "host");
    expect(publicQuiz(room.quiz).answer).toBe("n / m");
  });

  it("moves through the deck and finishes", () => {
    const room = setup();
    rooms.startQuiz(room, "host");
    rooms.nextCard(room, "host");
    expect(room.quiz.currentIndex).toBe(1);
    expect(room.quiz.answeredIds).toEqual([]);
    rooms.nextCard(room, "host");
    expect(room.quiz.phase).toBe("finished");
    expect(() => rooms.submitAnswer(room, "sam", "alpha")).toThrow(/no open question/);
  });

  it("resets scores when a new quiz starts", () => {
    const room = setup();
    rooms.startQuiz(room, "host");
    rooms.submitAnswer(room, "sam", "n/m");
    rooms.startQuiz(room, "host");
    expect(room.members.get("sam")?.score).toBe(0);
  });

  it("refuses to start with an empty deck or remove cards mid-quiz", () => {
    const empty = rooms.createRoom("x", "X");
    expect(() => rooms.startQuiz(empty, "x")).toThrow(/at least one card/);
    const room = setup();
    rooms.startQuiz(room, "host");
    expect(() => rooms.removeCard(room, "host", room.quiz.cards[0].id)).toThrow(RoomError);
  });
});

describe("normalizeAnswer", () => {
  it("lowercases and strips punctuation and extra spaces", () => {
    expect(normalizeAnswer("  O(1)  Amortized! ")).toBe("o 1 amortized");
  });
});
