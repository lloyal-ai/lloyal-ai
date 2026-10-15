import type { AppState } from "./state.js";
export type LightState =
  "still" | "reading" | "writing" | "settling" | "cooling";
export interface InquiryLight {
  id: number;
  state: LightState;
}
/** Only observed inquiries produce lights. A proposed plan is not execution. */
export function inquiryLights(state: AppState): InquiryLight[] {
  const work = state.work;
  if (!work || work.conversationId !== state.activeId) return [];
  return [...work.roster.agents.values()]
    .filter((a) => {
      const key = work.keys[a.id];
      return (
        key &&
        key !== "decision" &&
        (key === "answer" || work.revisions[a.id] === work.plan?.revision)
      );
    })
    .map((a) => ({
      id: a.id,
      state:
        work.paused || work.phase === "idle"
          ? "still"
          : a.phase === "failed"
            ? "cooling"
            : a.phase === "done"
              ? "settling"
              : a.recovering && !a.contentBuffer
                ? "cooling"
                : a.phase === "content"
                  ? "writing"
                  : "reading",
    }));
}
