// Types shared by the server and the client.

export type TimerMode = "focus" | "break";

export interface TimerState {
  mode: TimerMode;
  focusMinutes: number;
  breakMinutes: number;
  running: boolean;
  /** Epoch ms when the current phase ends (only while running). */
  endsAt: number | null;
  /** Milliseconds left in the current phase (kept while paused). */
  remainingMs: number;
  /** Number of completed focus sessions in this room. */
  completedSessions: number;
}

export interface Member {
  id: string;
  name: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  memberId: string;
  name: string;
  text: string;
  sentAt: number;
}

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
}

export type QuizPhase = "idle" | "question" | "reveal" | "finished";

export interface QuizState {
  phase: QuizPhase;
  cards: Flashcard[];
  currentIndex: number;
  /** Member ids that answered the current card correctly. */
  correctIds: string[];
  /** Member ids that have submitted an answer for the current card. */
  answeredIds: string[];
}

/** The quiz as clients see it: answers stay hidden until revealed. */
export interface PublicQuizState {
  phase: QuizPhase;
  cardCount: number;
  currentIndex: number;
  question: string | null;
  answer: string | null;
  correctIds: string[];
  answeredIds: string[];
  /** Questions only, so everyone can see what the host has added. */
  deck: { id: string; question: string }[];
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  members: Member[];
  timer: TimerState;
  quiz: PublicQuizState;
  chat: ChatMessage[];
  /** Server clock at send time, so clients can correct for clock drift. */
  serverNow: number;
}

// Socket.IO event contracts.

export type Ack<T = undefined> = (result: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  "room:create": (payload: { name: string }, ack: Ack<{ code: string; memberId: string }>) => void;
  "room:join": (
    payload: { code: string; name: string },
    ack: Ack<{ code: string; memberId: string }>,
  ) => void;
  "room:leave": () => void;
  "timer:start": () => void;
  "timer:pause": () => void;
  "timer:reset": () => void;
  "timer:configure": (payload: { focusMinutes: number; breakMinutes: number }, ack?: Ack) => void;
  "chat:send": (payload: { text: string }, ack?: Ack) => void;
  "quiz:addCard": (payload: { question: string; answer: string }, ack?: Ack) => void;
  "quiz:removeCard": (payload: { cardId: string }) => void;
  "quiz:start": (ack?: Ack) => void;
  "quiz:answer": (payload: { answer: string }, ack?: Ack<{ correct: boolean }>) => void;
  "quiz:reveal": () => void;
  "quiz:next": () => void;
  "quiz:end": () => void;
}

export interface ServerToClientEvents {
  "room:state": (snapshot: RoomSnapshot) => void;
}
