/** The Write moment: one section per task in the plan, each filled by whichever attempt at it is current, and
 *  the settling pass that follows them. */
import { type AppState } from "../state.js";
import { type Answer, activeDoc } from "./canvas.js";
import { type Inquiry, currentAttempts, handingIn, proseOf, verbOf } from "./inquiry.js";
import { settlingOf } from "./settle.js";

export interface Section {
  index: number;
  title: string;
  task: string;
  /** Deep mode: this section opens from its predecessors' findings. */
  inherits: boolean;
  inquiry: Inquiry | null;
  /** Named by the plan, but no branch free yet — `nSeqMax` is a hard
   *  reservation, so a wide plan forks in waves. True only while queued;
   *  the section head wears a clock until its inquiry starts. */
  waiting: boolean;
  /** The section's prose: the inquiry's report (draft) — streaming while
   *  it writes, settled when it lands. Its citations are already inline. */
  prose: string | null;
  streaming: boolean;
}

/** The section head IS the task, whole — the reader always sees exactly
 *  what its inquiry is answering. Long heads wrap; the rail ellipsizes. */
const sectionTitle = (task: string): string => task;

export const selectSections = (app: AppState): Section[] => {
  const doc = activeDoc(app);
  const attempts = currentAttempts(doc);
  const reports = handingIn(doc);
  return (doc.plan?.tasks ?? []).map((task, index) => {
    const a = attempts.get(index) ?? null;
    const { prose, streaming } = a ? proseOf(a, reports) : { prose: null, streaming: false };
    return {
      index,
      title: sectionTitle(task.description),
      task: task.description,
      inherits: doc.mode === "deep" && index > 0,
      // Derived: a flat-mode task the plan named with no agent yet, while the pool is still seating.
      waiting: !a && doc.mode === "flat" && doc.phase === "research",
      inquiry: a && {
        id: a.id,
        index,
        verb: verbOf(a, reports),
        startedAt: a.startedAt,
        endedAt: a.endedAt,
      },
      prose,
      streaming,
    };
  });
};

/** The settling pass: after the inquiries, the brief is edited into one voice — what its agent deliberates and
 *  writes, while the pass is open. */
export const selectSettling = (app: AppState): Answer | null =>
  activeDoc(app).synth.open ? settlingOf(activeDoc(app)) : null;
