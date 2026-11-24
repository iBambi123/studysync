// Pure room logic: no sockets, no timers, no I/O.
// Every function that depends on time takes `now` as an argument,
// which keeps the logic deterministic and easy to test.

import type {
  ChatMessage,
  Flashcard,
  Member,
  PublicQuizState,
  QuizState,
  RoomSnapshot,
  TimerState,
} from "../../shared/types.js";

export const LIMITS = {
  nameLength: 24,
  chatLength: 500,
  chatHistory: 100,
  questionLength: 300,
  answerLength: 200,
  deckSize: 100,
  roomSize: 20,
  minMinutes: 1,
  maxMinutes: 120,
} as const;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

export class RoomError extends Error {}

export interface Room {
  code: string;
  hostId: string;
  members: Map<string, Member>;
  timer: TimerState;
  quiz: QuizState;
  chat: ChatMessage[];
  nextId: number;
}

function cleanText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw new RoomError(`${field} is required`);
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new RoomError(`${field} is required`);
  if (text.length > max) throw new RoomError(`${field} must be ${max} characters or fewer`);
  return text;
}

export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function newTimer(focusMinutes = 25, breakMinutes = 5): TimerState {
  return {
    mode: "focus",
    focusMinutes,
    breakMinutes,
    running: false,
    endsAt: null,
    remainingMs: focusMinutes * 60_000,
    completedSessions: 0,
  };
}

function newQuiz(): QuizState {
  return { phase: "idle", cards: [], currentIndex: 0, correctIds: [], answeredIds: [] };
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** Which room each member (socket) is in. */
  private memberRoom = new Map<string, string>();

  constructor(private random: () => number = Math.random) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  roomOf(memberId: string): Room | undefined {
    const code = this.memberRoom.get(memberId);
    return code ? this.rooms.get(code) : undefined;
  }

  allRooms(): IterableIterator<Room> {
    return this.rooms.values();
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError("Could not create a room right now, please try again");
  }

  createRoom(memberId: string, name: string): Room {
    const cleanName = cleanText(name, LIMITS.nameLength, "Name");
    this.leave(memberId);
    const room: Room = {
      code: this.generateCode(),
      hostId: memberId,
      members: new Map([[memberId, { id: memberId, name: cleanName, score: 0 }]]),
      timer: newTimer(),
      quiz: newQuiz(),
      chat: [],
      nextId: 1,
    };
    this.rooms.set(room.code, room);
    this.memberRoom.set(memberId, room.code);
    return room;
  }

  joinRoom(memberId: string, code: string, name: string): Room {
    const cleanName = cleanText(name, LIMITS.nameLength, "Name");
    const room = this.getRoom(typeof code === "string" ? code.trim() : "");
    if (!room) throw new RoomError("Room not found. Check the code and try again");
    if (room.members.has(memberId)) return room;
    if (room.members.size >= LIMITS.roomSize) throw new RoomError("This room is full");
    this.leave(memberId);
    room.members.set(memberId, { id: memberId, name: cleanName, score: 0 });
    this.memberRoom.set(memberId, room.code);
    return room;
  }

  /** Removes the member. Returns the room they left, or undefined. Empty rooms are deleted. */
  leave(memberId: string): Room | undefined {
    const room = this.roomOf(memberId);
    if (!room) return undefined;
    room.members.delete(memberId);
    this.memberRoom.delete(memberId);
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return room;
    }
    if (room.hostId === memberId) {
      // Hand the host role to whoever joined earliest.
      room.hostId = room.members.keys().next().value as string;
    }
    return room;
  }

  // ---------- Timer ----------

  startTimer(room: Room, now: number): void {
    const t = room.timer;
    if (t.running) return;
    t.running = true;
    t.endsAt = now + t.remainingMs;
  }

  pauseTimer(room: Room, now: number): void {
    const t = room.timer;
    if (!t.running || t.endsAt === null) return;
    t.remainingMs = Math.max(0, t.endsAt - now);
    t.running = false;
    t.endsAt = null;
  }

  resetTimer(room: Room): void {
    const t = room.timer;
    room.timer = { ...newTimer(t.focusMinutes, t.breakMinutes), completedSessions: t.completedSessions };
  }

  configureTimer(room: Room, focusMinutes: number, breakMinutes: number): void {
    const valid = (m: number) => Number.isInteger(m) && m >= LIMITS.minMinutes && m <= LIMITS.maxMinutes;
    if (!valid(focusMinutes) || !valid(breakMinutes)) {
      throw new RoomError(`Minutes must be whole numbers from ${LIMITS.minMinutes} to ${LIMITS.maxMinutes}`);
    }
    room.timer.focusMinutes = focusMinutes;
    room.timer.breakMinutes = breakMinutes;
    this.resetTimer(room);
  }

  /**
   * Advances the timer if the current phase has ended.
   * Focus flows into break (and vice versa) without stopping.
   * Returns true when the phase changed.
   */
  tick(room: Room, now: number): boolean {
    const t = room.timer;
    if (!t.running || t.endsAt === null || now < t.endsAt) return false;
    const finishedAt = t.endsAt;
    if (t.mode === "focus") {
      t.completedSessions += 1;
      t.mode = "break";
      t.remainingMs = t.breakMinutes * 60_000;
    } else {
      t.mode = "focus";
      t.remainingMs = t.focusMinutes * 60_000;
    }
    t.endsAt = finishedAt + t.remainingMs;
    // If the server was asleep long enough to skip a whole phase, catch up.
    this.tick(room, now);
    return true;
  }

  // ---------- Chat ----------

  sendChat(room: Room, memberId: string, text: string, now: number): ChatMessage {
    const member = room.members.get(memberId);
    if (!member) throw new RoomError("You are not in this room");
    const message: ChatMessage = {
      id: String(room.nextId++),
      memberId,
      name: member.name,
      text: cleanText(text, LIMITS.chatLength, "Message"),
      sentAt: now,
    };
    room.chat.push(message);
    if (room.chat.length > LIMITS.chatHistory) room.chat.shift();
    return message;
  }

  // ---------- Quiz ----------

  private requireHost(room: Room, memberId: string): void {
    if (room.hostId !== memberId) throw new RoomError("Only the host can do that");
  }

  addCard(room: Room, memberId: string, question: string, answer: string): Flashcard {
    this.requireHost(room, memberId);
    if (room.quiz.cards.length >= LIMITS.deckSize) throw new RoomError("The deck is full");
    const card: Flashcard = {
      id: String(room.nextId++),
      question: cleanText(question, LIMITS.questionLength, "Question"),
      answer: cleanText(answer, LIMITS.answerLength, "Answer"),
    };
    room.quiz.cards.push(card);
    return card;
  }

  removeCard(room: Room, memberId: string, cardId: string): void {
    this.requireHost(room, memberId);
    if (room.quiz.phase === "question" || room.quiz.phase === "reveal") {
      throw new RoomError("Cards can't be removed during a quiz");
    }
    room.quiz.cards = room.quiz.cards.filter((c) => c.id !== cardId);
  }

  startQuiz(room: Room, memberId: string): void {
    this.requireHost(room, memberId);
    if (room.quiz.cards.length === 0) throw new RoomError("Add at least one card first");
    for (const m of room.members.values()) m.score = 0;
    room.quiz.phase = "question";
    room.quiz.currentIndex = 0;
    room.quiz.correctIds = [];
    room.quiz.answeredIds = [];
  }

  /** Records an answer. Each member gets one attempt per card. */
  submitAnswer(room: Room, memberId: string, answer: string): boolean {
    const quiz = room.quiz;
    const member = room.members.get(memberId);
    if (!member) throw new RoomError("You are not in this room");
    if (quiz.phase !== "question") throw new RoomError("There is no open question right now");
    if (quiz.answeredIds.includes(memberId)) throw new RoomError("You already answered this card");
    const guess = cleanText(answer, LIMITS.answerLength, "Answer");
    const card = quiz.cards[quiz.currentIndex];
    const correct = normalizeAnswer(guess) === normalizeAnswer(card.answer);
    quiz.answeredIds.push(memberId);
    if (correct) {
      quiz.correctIds.push(memberId);
      member.score += 1;
    }
    return correct;
  }

  revealAnswer(room: Room, memberId: string): void {
    this.requireHost(room, memberId);
    if (room.quiz.phase !== "question") throw new RoomError("There is no open question");
    room.quiz.phase = "reveal";
  }

  nextCard(room: Room, memberId: string): void {
    this.requireHost(room, memberId);
    const quiz = room.quiz;
    if (quiz.phase !== "reveal" && quiz.phase !== "question") throw new RoomError("No quiz in progress");
    if (quiz.currentIndex + 1 >= quiz.cards.length) {
      quiz.phase = "finished";
      return;
    }
    quiz.currentIndex += 1;
    quiz.phase = "question";
    quiz.correctIds = [];
    quiz.answeredIds = [];
  }

  endQuiz(room: Room, memberId: string): void {
    this.requireHost(room, memberId);
    room.quiz.phase = "idle";
    room.quiz.currentIndex = 0;
    room.quiz.correctIds = [];
    room.quiz.answeredIds = [];
  }

  // ---------- Snapshots ----------

  snapshot(room: Room, now: number): RoomSnapshot {
    return {
      code: room.code,
      hostId: room.hostId,
      members: [...room.members.values()].map((m) => ({ ...m })),
      timer: { ...room.timer },
      quiz: publicQuiz(room.quiz),
      chat: room.chat.slice(-50),
      serverNow: now,
    };
  }
}

/** Hides the answer to the current card until the host reveals it. */
export function publicQuiz(quiz: QuizState): PublicQuizState {
  const active = quiz.phase === "question" || quiz.phase === "reveal";
  const card = active ? quiz.cards[quiz.currentIndex] : undefined;
  return {
    phase: quiz.phase,
    cardCount: quiz.cards.length,
    currentIndex: quiz.currentIndex,
    question: card ? card.question : null,
    answer: card && quiz.phase === "reveal" ? card.answer : null,
    correctIds: [...quiz.correctIds],
    answeredIds: [...quiz.answeredIds],
    deck: quiz.cards.map((c) => ({ id: c.id, question: c.question })),
  };
}
