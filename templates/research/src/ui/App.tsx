/**
 * The view, shared by the desktop window and the browser: it shows what the harness says and sends what the
 * reader does. It holds no truth of its own — everything on screen is derived from the one fold every surface
 * shares — and this file only puts the current moment of a brief's life into the shell. It is yours: grow it
 * into your product's interface. The harness does not change when you do.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { DevPane } from "@lloyal-labs/dev-tools/react";
import { useHarness, useProjection, useSend } from "@lloyal-labs/ui";
import type { Command, WorkflowEvent } from "../protocol.js";
import type { AppState } from "./state.js";
import {
  depthOf, selectActiveDocId, selectAskInFlight, selectLive,
  selectMoment, selectRunDocId, selectShape, shapeOf,
  type Shape,
} from "./select.js";
import { recordPace } from "./pace.js";
import { APP } from "./presentation.js";
import { FRAMING } from "./devtools.js";
import { config } from "../config.js";
import { Shell } from "./parts/Shell.js";
import { Composer } from "./parts/Composer.js";
import { Library } from "./parts/Library.js";
import { Ask } from "./moments/Ask.js";
import { Frame } from "./moments/Frame.js";
import { Write } from "./moments/Write.js";
import { Settle } from "./moments/Settle.js";

const COMPOSER_HINT: Record<ReturnType<typeof selectMoment>, string> = {
  ask: "Ask a question worth a brief…",
  frame: "Answer, or refine the framing…",
  write: "The brief is writing…",
  settle: "Ask about this brief — the context is still warm…",
};

export function HarnessApp(): ReactElement {
  const send = useSend<Command>();
  const { bridge, projection } = useHarness<WorkflowEvent, Command, AppState>();
  const moment = useProjection(selectMoment);
  const live = useProjection(selectLive);
  const activeDocId = useProjection(selectActiveDocId);
  const askInFlight = useProjection(selectAskInFlight);
  const configuredShape = useProjection(selectShape);
  const [chosenShape, setChosenShape] = useState<Shape | null>(null);
  const shape = chosenShape ?? configuredShape;

  useEffect(() => {
    document.title = live ? `● ${APP.name}` : APP.name;
  }, [live]);

  // The library lists on arrival (the bridge queues until connected).
  useEffect(() => {
    send({ type: "library_list" });
  }, []);

  // Each settled brief teaches the pickers this machine's pace — recorded
  // once, when THE RUN ends, from the document it ran in: a run that settles
  // while the canvas is viewing another brief still counts. Warm follow-ups
  // (one synthetic task, no research) would poison the figure, so
  // single-task runs don't count; an abort teaches nothing. (The library
  // refresh is not the view's to infer: the harness announces it on settle.)
  const runDocId = useProjection(selectRunDocId);
  const lastRun = useRef(runDocId);
  useEffect(() => {
    const ended = lastRun.current;
    lastRun.current = runDocId;
    if (ended === null || runDocId !== null) return;
    const app = projection.getSnapshot();
    const doc = app.documents.get(ended);
    if (!doc || doc.phase !== "done") return;
    const tasks = doc.plan?.tasks.length ?? 0;
    if (tasks >= 2) recordPace(depthOf(app, doc), shapeOf(doc), tasks, doc.pipelineElapsedMs ?? 0);
  }, [runDocId]);

  return (
    <DevPane
      bridge={bridge}
      config={config}
      framing={FRAMING}
      title={APP.name}
      runCommands={{ stop: true, wrapUp: true, cancelAgent: true, pause: true }}
    >
      <Shell
        library={<Library />}
        dock={<Composer shape={shape} placeholder={askInFlight ? COMPOSER_HINT.write : COMPOSER_HINT[moment]} />}
      >
        {/* Identity remount — per-doc component state (disclosure toggles,
            edit fields) resets when the canvas turns over to another doc. */}
        <div key={activeDocId ?? "picker"} style={{ display: "contents" }}>
          {moment === "ask" && <Ask shape={shape} onShape={setChosenShape} />}
          {moment === "frame" && <Frame />}
          {moment === "write" && <Write />}
          {moment === "settle" && <Settle />}
        </div>
      </Shell>
    </DevPane>
  );
}
