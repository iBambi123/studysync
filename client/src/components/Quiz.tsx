import { useEffect, useState, type FormEvent } from "react";
import type { RoomApi } from "../useRoom";

export function Quiz({ api }: { api: RoomApi }) {
  const room = api.room!;
  const quiz = room.quiz;
  const host = api.isHost;
  const answered = !!api.memberId && quiz.answeredIds.includes(api.memberId);
  const gotIt = !!api.memberId && quiz.correctIds.includes(api.memberId);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [guess, setGuess] = useState("");

  // Clear the answer box when the card changes.
  useEffect(() => setGuess(""), [quiz.currentIndex, quiz.phase]);

  async function addCard(e: FormEvent) {
    e.preventDefault();
    const res = await api.request(() => api.socket.emitWithAck("quiz:addCard", { question, answer }));
    if (res.ok) {
      setQuestion("");
      setAnswer("");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!guess.trim()) return;
    await api.request(() => api.socket.emitWithAck("quiz:answer", { answer: guess }));
  }

  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? "Someone";

  return (
    <section className="card quiz">
      <div className="card__title">
        <h2>Flashcard quiz</h2>
        {quiz.phase !== "idle" && quiz.phase !== "finished" && (
          <span className="pill">
            Card {quiz.currentIndex + 1} of {quiz.cardCount}
          </span>
        )}
      </div>

      {quiz.phase === "idle" && (
        <>
          {quiz.deck.length > 0 ? (
            <ol className="deck">
              {quiz.deck.map((c) => (
                <li key={c.id}>
                  <span>{c.question}</span>
                  {host && (
                    <button
                      className="btn btn--ghost btn--small"
                      aria-label={`Remove card: ${c.question}`}
                      onClick={() => api.socket.emit("quiz:removeCard", { cardId: c.id })}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              {host ? "Add a few cards, then start the quiz." : "Waiting for the host to add cards."}
            </p>
          )}

          {host && (
            <>
              <form className="stack" onSubmit={addCard}>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={300}
                  placeholder="Question, e.g. What is the load factor of a hash table?"
                />
                <div className="row">
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    maxLength={200}
                    placeholder="Answer, e.g. n / m"
                  />
                  <button className="btn" disabled={!question.trim() || !answer.trim()}>
                    Add card
                  </button>
                </div>
              </form>
              <button
                className="btn btn--primary full"
                disabled={quiz.deck.length === 0}
                onClick={() => api.request(() => api.socket.emitWithAck("quiz:start"))}
              >
                Start quiz for everyone
              </button>
            </>
          )}
        </>
      )}

      {(quiz.phase === "question" || quiz.phase === "reveal") && (
        <>
          <p className="quiz__question">{quiz.question}</p>

          {quiz.phase === "question" && !answered && (
            <form className="row" onSubmit={submit}>
              <input
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="Your answer"
                autoFocus
              />
              <button className="btn btn--primary" disabled={!guess.trim()}>
                Submit
              </button>
            </form>
          )}
          {quiz.phase === "question" && answered && (
            <p className={gotIt ? "success" : "muted"}>
              {gotIt ? "Correct! Waiting for others…" : "Answer locked in. Waiting for others…"}
            </p>
          )}
          {quiz.phase === "reveal" && (
            <div className="reveal">
              <p>
                Answer: <strong>{quiz.answer}</strong>
              </p>
              <p className="muted small">
                {quiz.correctIds.length > 0
                  ? `Got it: ${quiz.correctIds.map(nameOf).join(", ")}`
                  : "Nobody got this one."}
              </p>
            </div>
          )}

          <p className="muted small">
            {quiz.answeredIds.length} of {room.members.length} answered
          </p>

          {host && (
            <div className="row">
              {quiz.phase === "question" && (
                <button className="btn" onClick={() => api.socket.emit("quiz:reveal")}>
                  Reveal answer
                </button>
              )}
              <button className="btn btn--primary" onClick={() => api.socket.emit("quiz:next")}>
                {quiz.currentIndex + 1 >= quiz.cardCount ? "Finish" : "Next card"}
              </button>
              <button className="btn btn--ghost" onClick={() => api.socket.emit("quiz:end")}>
                End quiz
              </button>
            </div>
          )}
        </>
      )}

      {quiz.phase === "finished" && (
        <>
          <p className="quiz__question">Quiz complete!</p>
          <ol className="podium">
            {[...room.members]
              .sort((a, b) => b.score - a.score)
              .map((m) => (
                <li key={m.id}>
                  <span>{m.name}</span>
                  <span className="score">
                    {m.score}/{quiz.cardCount}
                  </span>
                </li>
              ))}
          </ol>
          {host && (
            <button className="btn btn--primary full" onClick={() => api.socket.emit("quiz:end")}>
              Back to the deck
            </button>
          )}
        </>
      )}
    </section>
  );
}
