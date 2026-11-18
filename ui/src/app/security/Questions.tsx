/*
  A scan's questions, docked at its composer as one card (board D, after Devin's question card): "Question 2 of 3 ·
  answering is optional", the one before and after, Skip, and close (skip the rest); the answers lettered A, B, C,
  the first the scan's own guess, marked "My guess" with its reason at the row's end. A, B or C (or a click) takes an
  answer and goes on; the composer under the card takes your own words, and Enter in it alone takes the guess
  (ScanSession does those two). Nothing goes on by itself: the scan waits until every question is answered or skipped.

  Built on the app's own question item (Item kind "question", answered with question.answer): one item can hold several
  questions, paged here, and they go back together when the last is answered or skipped. ScanSession keeps where the card
  is (`state`), so the answers given so far can stay in the thread as you go.
*/
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Item } from "@contracts";
import { I } from "../icons";

export type QuestionItem = Extract<Item, { kind: "question" }>;
/** Where the card is: the question in view, and the answers given so far (question → answer). */
export type QState = { at: number; answers: Record<string, string> };

const LETTERS = "ABCDEFGHIJ";
/** The scan's own guess for a question: the option it marked, else its first. */
export const guessOf = (q: QuestionItem["questions"][number]) => q.options.find((o) => o.suggested || o.guess) ?? q.options[0];

/** Moves the card on from the question in view: to the next one, or, after the last, sends what was answered (`done`). */
export function onward(it: QuestionItem, s: QState, answers: Record<string, string>, done: (answers: Record<string, string>) => void): QState {
  if (s.at >= it.questions.length - 1) done(answers);
  return { at: Math.min(s.at + 1, it.questions.length - 1), answers };
}

export function ScanQuestions({ it, state, onState, onDone, note }: { it: QuestionItem; state: QState; onState: (s: QState) => void; /** Every question answered or skipped: the answers given (none: all skipped). */ onDone: (answers: Record<string, string>) => void; /** A line under the answers (what Enter in the composer will do). */ note?: string }) {
  const total = it.questions.length;
  const at = Math.min(state.at, total - 1);
  const q = it.questions[at];
  const chosen = q ? state.answers[q.question] : undefined;
  const start = q ? Math.max(0, q.options.findIndex((o) => (chosen ? o.label === chosen : o.suggested))) : 0;
  const [hl, setHl] = useState(start);
  useEffect(() => setHl(start), [at, it.id]);
  const card = useRef<HTMLElement>(null);
  // The card takes the keys when it comes, so A, B and C answer at once; but never from someone typing (in the composer,
  // a field): their letters stay theirs, and the card answers to its keys only once it has focus (a click, Tab).
  useEffect(() => {
    const at = document.activeElement;
    if (at instanceof HTMLElement && at.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
    card.current?.focus({ preventScroll: true });
  }, [it.id]);
  if (!q) return null;
  const pick = (label: string) => onState(onward(it, { at, answers: state.answers }, { ...state.answers, [q.question]: label }, onDone));
  const skip = () => {
    const { [q.question]: _left, ...rest } = state.answers;
    onState(onward(it, { at, answers: rest }, rest, onDone));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    if (e.target instanceof HTMLElement && e.target.closest("textarea, input")) return;
    const i = LETTERS.indexOf(e.key.toUpperCase());
    if (e.key.length === 1 && i >= 0 && i < q.options.length) {
      e.preventDefault();
      pick(q.options[i].label);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && q.options.length) {
      e.preventDefault();
      setHl((h) => (h + (e.key === "ArrowDown" ? 1 : q.options.length - 1)) % q.options.length);
    } else if (e.key === "Enter" && q.options[hl] && !(e.target instanceof HTMLElement && e.target.closest("button"))) {
      e.preventDefault();
      pick(q.options[hl].label);
    }
  };
  return (
    <section ref={card} className="lsc-ask" tabIndex={-1} aria-label={`The scan asks: ${q.question}`} onKeyDown={onKey}>
      <div className="lc-trow lsc-ask-top">
        <I.ask size={16} />
        <span className="lc-trow-t lc-grow">
          {total > 1 ? `Question ${at + 1} of ${total} · answering is optional` : "A question · answering is optional"}
        </span>
        {total > 1 && (
          <>
            <button type="button" className="lc-ib l-focus" aria-label="The question before" title="The question before" disabled={at === 0} onClick={() => onState({ ...state, at: at - 1 })}>
              <I.chevL size={14} />
            </button>
            <button type="button" className="lc-ib l-focus" aria-label="The next question" title="The next question" disabled={at === total - 1} onClick={() => onState({ ...state, at: at + 1 })}>
              <I.chevR size={14} />
            </button>
          </>
        )}
        <button type="button" className="lc-trow-lk l-focus" title="Skip this question: the scan goes by its guess and says so" onClick={skip}>
          Skip
        </button>
        <button type="button" className="lc-ib l-focus" aria-label={total > 1 ? "Skip all the questions" : "Skip the question"} title={total > 1 ? "Skip the rest: the scan goes by its guesses" : "Skip it: the scan goes by its guess"} onClick={() => onDone(state.answers)}>
          <I.close size={14} />
        </button>
      </div>
      <div className="lsc-ask-h">{q.question}</div>
      {q.options.length > 0 ? (
        <div className="lsc-ask-opts" role="radiogroup" aria-label={q.question}>
          {q.options.map((o, i) => (
            <button key={o.label} type="button" role="radio" aria-checked={chosen === o.label} className="lsc-ask-opt l-focus" data-hl={i === hl || undefined} onMouseEnter={() => setHl(i)} onClick={() => pick(o.label)}>
              <kbd>{LETTERS[i]}</kbd>
              <span className="lsc-ask-l">{o.label}</span>
              {o === guessOf(q) && <span className="ls-tag">My guess</span>}
              {o.description && <span className="lsc-ask-why">{o.description}</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="lsc-ask-free">Type your answer in the box below, or skip it.</p>
      )}
      {note && <p className="lsc-ask-free">{note}</p>}
    </section>
  );
}
