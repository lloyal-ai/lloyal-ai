/** What the enlarged view shows, and the hold a video puts on the run.
 *
 *  Where the page and the model share a GPU, a video cannot play while the model decodes. So a video opened while
 *  the run works holds the run, and closing it lets go of that hold and of no other: a run the reader held
 *  themselves stays held. A hold the run has not taken (it is between steps, or closing) leaves the video covered
 *  until the run is held or settles. An image or a document needs no GPU to show, so it never holds the run.
 *
 *  Pure: the run's facts come in as arguments, and the commands go out as values for the caller to send. */
import type { LightboxProps } from "@lloyal-labs/ui";
import type { Command } from "../protocol.js";

/** What the enlarged view shows: an image by its root, a document, or a video. */
export type Opened = Omit<LightboxProps, "onClose" | "styles">;

/** The run as the view knows it: whether it is working, and whether it is held. */
export interface RunFacts { live: boolean; paused: boolean }

/** What is open, and whether opening it held the run. */
export interface Viewing { opened: Opened; holds: boolean }

type Hold = Extract<Command, { type: "pause" } | { type: "resume" }>;

const isVideo = (opened: Opened): boolean => opened.video !== undefined;
const working = (run: RunFacts): boolean => run.live && !run.paused;

/** Open `opened`: a video while the run works holds it. */
export const opening = (opened: Opened, run: RunFacts): { viewing: Viewing; command: Hold | null } => {
  const holds = isVideo(opened) && working(run);
  return { viewing: { opened, holds }, command: holds ? { type: "pause" } : null };
};

/** Close what is open: the hold it put on the run is let go. */
export const closing = (viewing: Viewing): Hold | null => (viewing.holds ? { type: "resume" } : null);

/** Whether a video waits for the run to be held or to settle before it can play. */
export const covered = (viewing: Viewing, run: RunFacts): boolean => isVideo(viewing.opened) && working(run);
