/** What this app is called, said once, and the one sentence every view says in its own place. Every surface reads
 *  them from here: the sidebar, the browser tab, the desktop window, the terminal header, the served host and the
 *  dev pane.
 *
 *  `name` is for people: change it whenever you like. `storage` prefixes what a browser remembers for a reader
 *  (the open panel, this machine's pace), so it is kept apart: renaming the app does not forget any of that,
 *  and changing `storage` does. Node-free, so every target can import it. */
import type { Unanswered } from "../protocol.js";

export const APP = {
  name: "__NAME__",
  storage: "__NAME__",
} as const;

/** Said where an answer would be, for a brief or a follow-up that ran to its end and found nothing: no report was
 *  written, nothing was invented. */
export const NOTHING_KEPT = "The sources turned up nothing to settle this on — nothing was kept.";

/** Said instead when the context was too full for an agent to start: nothing was searched, so nothing was found. */
export const NO_ROOM = "This brief's context had no room left for an agent to work in, so nothing was kept. Start a new brief, or ask without attaching more.";

/** The words for an empty answer: why it is empty, when the run said. */
export const nothingKept = (unanswered: Unanswered | null | undefined): string =>
  unanswered === "no_room" ? NO_ROOM : NOTHING_KEPT;

/** Said on a video whose soundtrack was not all transcribed: what the model will not hear, before the question is sent. */
export const untranscribedNotice = (windows: readonly { startMs: number; endMs: number }[]): string | null => {
  if (windows.length === 0) return null;
  const clock = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1_000) % 60).padStart(2, "0")}`;
  const span = (w: { startMs: number; endMs: number }): string => `${clock(w.startMs)} to ${clock(w.endMs)}`;
  return windows.length <= 2
    ? `The model won't hear the speech from ${windows.map(span).join(" and ")}.`
    : `The model won't hear the speech in ${windows.length} parts of this video, from ${span({ startMs: windows[0].startMs, endMs: windows[windows.length - 1].endMs })}.`;
};
