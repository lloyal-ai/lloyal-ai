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
import { useEffect, useState, type ReactElement } from "react";
import { DevPane } from "@lloyal-labs/dev-tools/react";
import type { DevControl } from "@lloyal-labs/dev-tools";
import { useBrief } from "./store.js";
import { selectLive, selectMoment, selectShape, type Shape } from "./select.js";
import { Shell } from "./parts/Shell.js";
import { Composer } from "./parts/Composer.js";
import { Ask } from "./moments/Ask.js";
import { Frame } from "./moments/Frame.js";
import { Write } from "./moments/Write.js";
import { Settle } from "./moments/Settle.js";

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
  const [chosenShape, setChosenShape] = useState<Shape | null>(null);
  const shape = chosenShape ?? configuredShape;

  useEffect(() => {
    document.title = live ? "● __NAME__" : "__NAME__";
  }, [live]);

  return (
    <DevPane
      bridge={window.harness}
      controls={DEV_CONTROLS}
      title="__NAME__"
      runCommands={{ stop: true, wrapUp: true, cancelAgent: true, pause: true }}
    >
      <Shell
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
