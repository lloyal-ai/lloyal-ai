/**
 * The shared React view — desktop and web both mount this ONE component, and
 * it folds the SAME node-free `reduce` (`harness/state.ts`) the cli's Ink
 * view does: one harness, one fold, one brief.
 *
 * The view is a renderer of the harness's events and a dispatcher of its
 * commands — the fold lives in `store.ts`, every derivation in `select.ts`,
 * the register in `theme.ts`, and each moment of the journey in `moments/`.
 * This file only maps the current moment onto the shell. It is YOURS: grow
 * it into your product's UI; the harness never changes.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { DevPane } from "@lloyal-labs/dev-tools/react";
import type { DevControl } from "@lloyal-labs/dev-tools";
import { send, useBrief } from "./store.js";
import {
  selectDepth, selectFetched, selectLive, selectMoment, selectRunShape,
  selectShape, selectTaskCount, type Shape,
} from "./select.js";
import { recordPace } from "./pace.js";
import { Shell } from "./parts/Shell.js";
import { Composer } from "./parts/Composer.js";
import { Library } from "./parts/Library.js";
import { Ask } from "./moments/Ask.js";
import { Frame } from "./moments/Frame.js";
import { Write } from "./moments/Write.js";
import { Settle } from "./moments/Settle.js";
import { Reopen } from "./moments/Reopen.js";

/** The dev pane's Settings contribution — pure data, dev-gated by the wire. */
const DEV_CONTROLS: readonly DevControl[] = [
  {
    key: "defaults.effort",
    values: ["low", "medium", "high", "ultra"],
    command: "set_effort",
    field: "effort",
    note: "applies next run",
    read: (c) => (c.defaults as { effort?: string } | undefined)?.effort,
  },
  {
    key: "defaults.reasoningMode",
    originKey: "reasoningMode",
    values: ["flat", "deep"],
    command: "change_mode",
    field: "mode",
    note: "applies next run",
    read: (c) => (c.defaults as { reasoningMode?: string } | undefined)?.reasoningMode,
  },
];

const COMPOSER_HINT: Record<ReturnType<typeof selectMoment>, string> = {
  ask: "Ask a question worth a brief…",
  frame: "Answer, or refine the framing…",
  write: "The brief is writing…",
  settle: "Ask about this brief — the context is still warm…",
};

export function HarnessApp(): ReactElement {
  const moment = useBrief(selectMoment);
  const live = useBrief(selectLive);
  const configuredShape = useBrief(selectShape);
  const fetched = useBrief(selectFetched);
  const [chosenShape, setChosenShape] = useState<Shape | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const shape = chosenShape ?? configuredShape;

  useEffect(() => {
    document.title = live ? "● __NAME__" : "__NAME__";
  }, [live]);

  // The library lists on arrival; a submitted query takes the canvas back
  // from any reopened report.
  useEffect(() => {
    send({ type: "library_list" });
  }, []);
  useEffect(() => {
    if (live) setOpenReport(null);
  }, [live]);

  // Each settled brief teaches the pickers this machine's pace — recorded
  // once, on the edge into settle. Warm follow-ups (one synthetic task,
  // no research) would poison the figure, so single-task runs don't count.
  // The same edge refreshes the library: a settle means a new report.
  const depth = useBrief(selectDepth);
  const runShape = useBrief(selectRunShape);
  const tasks = useBrief(selectTaskCount);
  const banked = useBrief((app) => app.pipelineElapsedMs);
  const prevMoment = useRef(moment);
  useEffect(() => {
    if (moment === "settle" && prevMoment.current !== "settle") {
      if (tasks !== null && tasks >= 2) recordPace(depth, runShape, tasks, banked);
      send({ type: "library_list" });
    }
    prevMoment.current = moment;
  }, [moment, depth, runShape, tasks, banked]);

  const reopened = openReport !== null && fetched?.path === openReport;

  return (
    <DevPane
      bridge={window.harness}
      controls={DEV_CONTROLS}
      title="__NAME__"
      runCommands={{ stop: true, wrapUp: true, cancelAgent: true, pause: true }}
    >
      <Shell
        library={<Library open={openReport} onOpen={setOpenReport} />}
        dock={
          <Composer
            shape={shape}
            placeholder={reopened ? COMPOSER_HINT.ask : COMPOSER_HINT[moment]}
            reframe={reopened}
          />
        }
      >
        {reopened ? (
          <Reopen body={fetched.body} />
        ) : (
          <>
            {moment === "ask" && <Ask shape={shape} onShape={setChosenShape} />}
            {moment === "frame" && <Frame />}
            {moment === "write" && <Write />}
            {moment === "settle" && <Settle />}
          </>
        )}
      </Shell>
    </DevPane>
  );
}
