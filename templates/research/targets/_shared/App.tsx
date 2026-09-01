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
import type { DevControl, RunFraming } from "@lloyal-labs/dev-tools";
import { send, useBrief } from "./store.js";
import {
  selectDepth, selectLive, selectMoment, selectRunShape, selectShape,
  selectTaskCount, type Shape,
} from "./select.js";
import { recordPace } from "./pace.js";
import { Shell } from "./parts/Shell.js";
import { Composer } from "./parts/Composer.js";
import { Library } from "./parts/Library.js";
import { Ask } from "./moments/Ask.js";
import { Frame } from "./moments/Frame.js";
import { Write } from "./moments/Write.js";
import { Settle } from "./moments/Settle.js";

/** The pipeline's run framing, as data the dev pane reads — which of OUR
 *  events open and close a run, and which mark the phases whose labels the
 *  agent lanes wear. Add or rename a stage in the pipeline? Extend this
 *  beside it and the pane follows; it knows no event names of its own. */
const FRAMING: RunFraming = {
  phases: {
    "preflight:start": "recon",
    "plan:start": "planner",
    "research:start": "research",
    "synthesize:start": "synth",
  },
  open: ["preflight:start", "plan:start", "query"],
  close: ["complete", "ui:error", "ui:composer"],
};

/** Per-image token budget steps. `auto` first, because handing the choice
 *  back to the model's metadata is the default and has to stay reachable. */
const IMAGE_TOKEN_STEPS = ["auto", "256", "512", "1024", "2048", "4096"] as const;

type ImageTokenModel = { imageMinTokens?: number; imageMaxTokens?: number };

/** Config value → the step that represents it. 0 and undefined are the same
 *  state (the binding applies the value only when > 0), and both read `auto`.
 *  A value set in harness.yml that is not one of the steps shows as itself
 *  rather than snapping to a neighbour — the slider then sits at `auto`,
 *  which is honest: the UI cannot represent it. */
const imageTokenStep = (v: number | undefined): string =>
  !v ? "auto" : String(v);

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
  // Sliders, not button rows: these are scales, so the ordering carries the
  // meaning. 'auto' is a real step — it hands the choice back to the model's
  // own metadata, which is the right default and must stay reachable.
  {
    key: "model.imageMaxTokens",
    values: IMAGE_TOKEN_STEPS,
    render: "slider",
    command: "set_image_max_tokens",
    field: "value",
    note: "reloads the runtime",
    read: (c) => imageTokenStep((c.model as ImageTokenModel | undefined)?.imageMaxTokens),
  },
  {
    key: "model.imageMinTokens",
    values: IMAGE_TOKEN_STEPS,
    render: "slider",
    command: "set_image_min_tokens",
    field: "value",
    note: "reloads the runtime",
    read: (c) => imageTokenStep((c.model as ImageTokenModel | undefined)?.imageMinTokens),
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
  const [chosenShape, setChosenShape] = useState<Shape | null>(null);
  const shape = chosenShape ?? configuredShape;

  useEffect(() => {
    document.title = live ? "● __NAME__" : "__NAME__";
  }, [live]);

  // The library lists on arrival (the bridge queues until connected).
  useEffect(() => {
    send({ type: "library_list" });
  }, []);

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

  return (
    <DevPane
      bridge={window.harness}
      framing={FRAMING}
      controls={DEV_CONTROLS}
      title="__NAME__"
      runCommands={{ stop: true, wrapUp: true, cancelAgent: true, pause: true }}
    >
      <Shell
        library={<Library />}
        dock={<Composer shape={shape} placeholder={COMPOSER_HINT[moment]} />}
      >
        {moment === "ask" && <Ask shape={shape} onShape={setChosenShape} />}
        {moment === "frame" && <Frame />}
        {moment === "write" && <Write />}
        {moment === "settle" && <Settle />}
      </Shell>
    </DevPane>
  );
}
