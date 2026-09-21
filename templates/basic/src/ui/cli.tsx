/**
 * The terminal view — a `render`-style binding: `(bus, dispatch, bootstrap) =>
 * dispose`. It subscribes to your events, folds them through `reduce`
 * (state.ts), and renders the standard `AppState`. It knows nothing about your
 * domain — swap it, or grow it, or keep it; the harness never changes.
 *
 * Austere on purpose (the browser/desktop view is the rich one): a header, the
 * LIVE agents as side-by-side columns, a KV gauge, an input line — and finished
 * agents + each answer committed to Ink's `<Static>`, which paints them to the
 * terminal's scrollback ONCE and never re-renders them. That's the load-bearing
 * detail: without it, a long run's growing tree overflows the viewport and Ink
 * clears the screen (wiping your history). Live in the dynamic frame, done in
 * Static.
 */
import React, { useEffect, useReducer, useRef, useState } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import type { EventBus } from "@lloyal-labs/binding";
import {
  initialState,
  reduce,
  formatSize,
  isWikiAgent,
  isLiveAgent,
  reasoningOf,
} from "./state.js";
import type {
  AgentRuntime,
  AppState,
  Phase,
  TimelineItem,
  WikiSource,
} from "./state.js";
import { hostOf } from "@lloyal-labs/ui/fold";
import { lastLine } from "../common/util.js";
import type { Command, WorkflowEvent } from "../protocol.js";
import { useDevOverlay } from "@lloyal-labs/dev-tools/ink";
import { APP } from "./presentation.js";
import { FRAMING } from "./devtools.js";

const seed = (bootstrap: readonly WorkflowEvent[]): AppState =>
  bootstrap.reduce(reduce, initialState);

const glyph = (p: AgentRuntime["phase"]): string =>
  p === "tool" ? "◍" : p === "done" ? "✓" : p === "failed" ? "✗" : "●";

const statusColor = (p: AgentRuntime["phase"]): string =>
  p === "tool" ? "cyan" : p === "done" ? "green" : p === "failed" ? "red" : "yellow";

/** The tool rows of an agent's timeline, newest last — a call and, once it lands, its result. */
const toolRows = (a: AgentRuntime): TimelineItem[] =>
  (a.timeline ?? []).filter((it) => it.kind === "tool_call" || it.kind === "tool_result");

/** One timeline row as an atomic chip: `⚒ tool · args` for a call, `→ meta` for its result. */
function ToolChip({ item }: { item: TimelineItem }): React.ReactElement | null {
  if (item.kind === "tool_call") {
    return (
      <Text wrap="truncate-end">
        <Text color="magenta">⚒ {item.tool}</Text>
        {item.argsSummary ? <Text dimColor>{`  ${item.argsSummary}`}</Text> : null}
      </Text>
    );
  }
  if (item.kind !== "tool_result") return null;
  const meta =
    item.resultCount !== null
      ? `${item.resultCount} result${item.resultCount === 1 ? "" : "s"}`
      : `${item.byteLength}b`;
  return (
    <Text wrap="truncate-end">
      <Text color="green">{`  → ${meta}`}</Text>
      {item.preview ? <Text dimColor>{`  ${item.preview}`}</Text> : null}
    </Text>
  );
}

/** A LIVE agent, as a fixed-width column: header · recent tool chips · a short
 *  narration preview (the last line of the model's prose, XML stripped). The
 *  bounded shape (last 4 chips + 1 line) keeps the dynamic frame small. */
function AgentColumn({ a, width }: { a: AgentRuntime; width: number }): React.ReactElement {
  const preview = lastLine(reasoningOf(a));
  return (
    <Box flexDirection="column" width={width} marginRight={2}>
      <Text wrap="truncate-end">
        <Text color={statusColor(a.phase)}>{glyph(a.phase)}</Text>
        {` ${a.label}`}
        <Text dimColor>{` · ${a.tokenCount} tok`}</Text>
      </Text>
      {toolRows(a).slice(-4).map((t) => (
        <ToolChip key={t.id} item={t} />
      ))}
      {preview ? (
        <Text dimColor wrap="truncate-end">
          {preview}
        </Text>
      ) : null}
    </Box>
  );
}

/** A FINISHED wiki agent, collapsed to a one-line summary in Static — the
 *  live detail scrolled by; the record is a tidy line. */
function FinishedAgentRow({ a }: { a: AgentRuntime }): React.ReactElement {
  const reads = (a.timeline ?? []).filter(
    (it) => it.kind === "tool_result" && it.tool === "wikipedia_fetch",
  ).length;
  return (
    <Text>
      <Text color={statusColor(a.phase)}>{glyph(a.phase)}</Text>
      {` ${a.label}`}
      <Text dimColor>
        {` · ${a.toolCallCount} tool${a.toolCallCount === 1 ? "" : "s"}`}
        {reads ? ` · ${reads} article${reads === 1 ? "" : "s"}` : ""}
      </Text>
    </Text>
  );
}

/** A committed answer in Static: the clean report text + its grounded sources. */
function AnswerBlock({ text, sources }: { text: string; sources: WikiSource[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan">{text}</Text>
      {sources.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Sources</Text>
          {sources.map((s, i) => (
            <Text key={i} dimColor wrap="truncate-end">
              {`  ${i + 1}. ${s.title}${s.url ? ` · ${hostOf(s.url)}` : ""}`}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function Gauge({ used, total }: { used: number; total: number }): React.ReactElement | null {
  if (!total) return null;
  const pct = Math.min(100, Math.round((100 * used) / total));
  const width = 16;
  const filled = Math.round((pct / 100) * width);
  return (
    <Text color="gray">
      KV {"█".repeat(filled)}
      {"░".repeat(width - filled)} {pct}%
    </Text>
  );
}

/** One committed line of scrollback — a finished agent or an answer. */
type Scrollback =
  | { kind: "agent"; agent: AgentRuntime }
  | { kind: "answer"; text: string; sources: WikiSource[] };

function View({
  bus,
  dispatch,
  bootstrap,
}: {
  bus: EventBus<WorkflowEvent>;
  dispatch: (c: Command) => void;
  bootstrap: readonly WorkflowEvent[];
}): React.ReactElement {
  const [state, apply] = useReducer(reduce, bootstrap, seed);
  const app = useApp();

  // The dev overlay: nothing unless the wire said dev (LLOYAL_DEV), ctrl+g to show it. The hook owns the rest.
  const dev = useDevOverlay(bus, { framing: FRAMING });

  useEffect(() => bus.subscribe(apply), [bus]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      dispatch({ type: "quit" });
      app.exit();
    }
    if (key.ctrl && input === "g") dev.toggle();
  });

  // Move finished work into Static so it's painted to scrollback ONCE and never
  // re-rendered: each wiki agent when it terminates, and each answer on the
  // working→answered transition. The dynamic frame below then holds only the
  // live agents + input, so it can't grow past the viewport and trigger Ink's
  // clear-on-overflow.
  const [scrollback, setScrollback] = useState<Scrollback[]>([]);
  const committed = useRef<Set<number>>(new Set());
  const printed = useRef(0);
  useEffect(() => {
    const add: Scrollback[] = [];
    for (const a of state.roster.agents.values()) {
      if (isWikiAgent(a) && !isLiveAgent(a) && !committed.current.has(a.id)) {
        committed.current.add(a.id);
        add.push({ kind: "agent", agent: a });
      }
    }
    // What is printed is a newly ACCEPTED article, which is neither a new phase nor new text. Several things
    // return the page to `answered` holding what it already held — a follow-up that found nothing, and a
    // stopped one — and printing on the phase repeats the article. Two turns can also settle on the same
    // prose, and printing on the text would swallow the second one along with the sources it found.
    if (state.accepted > printed.current) {
      printed.current = state.accepted;
      add.push({ kind: "answer", text: state.answer, sources: state.sources });
    }
    if (add.length) setScrollback((s) => [...s, ...add]);
  }, [state]);

  const working = state.phase === "working";
  // Only the still-running agents stay in the dynamic frame; finished ones are
  // in Static. The synth (tool-less) streams here as a column until it's done.
  const live = [...state.roster.agents.values()].filter(isLiveAgent);
  const cols = process.stdout.columns ?? 80;
  const colWidth = Math.max(30, Math.min(56, Math.floor((cols - 2) / Math.max(1, live.length)) - 2));

  return (
    <>
      <Static items={scrollback}>
        {(item, i) =>
          item.kind === "agent" ? (
            <FinishedAgentRow key={`sb-${i}`} a={item.agent} />
          ) : (
            <AnswerBlock key={`sb-${i}`} text={item.text} sources={item.sources} />
          )
        }
      </Static>

      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{APP.name}</Text>
          {/* Measured facts from the `ready` event — the model's real size + the
              abilities actually enabled, never a hardcoded string. */}
          {state.boot ? (
            <>
              <Text color="gray">{`Model      ${state.boot.model.id} · ${formatSize(state.boot.model.sizeBytes)} · resident`}</Text>
              <Text color="gray">Inference  local · no provider</Text>
              <Text color="gray">{`Abilities       ${state.boot.abilities.length ? state.boot.abilities.join(", ") : "none installed"}`}</Text>
              <Text color="gray">Surface    cli</Text>
              {state.library.length > 0 && (
                // The terminal reports what is kept and leaves browsing to the other two surfaces: a reflow
                // into topics is not something a scrolling view can show honestly.
                <Text color="gray">{`Kept       ${state.library.length} article${state.library.length === 1 ? "" : "s"}`}</Text>
              )}
            </>
          ) : (
            <Text color="gray">booting…</Text>
          )}
        </Box>

        {live.length > 0 && (
          <Box flexDirection="column">
            <Box flexWrap="wrap">
              {live.map((a) => (
                <AgentColumn key={a.id} a={a} width={colWidth} />
              ))}
            </Box>
            <Gauge used={state.kv.used} total={state.kv.total} />
          </Box>
        )}

        {state.nothingFound && (
          <Text color="yellow">nothing found on Wikipedia for that — try naming the subject more directly.</Text>
        )}

        {state.error && <Text color="red">error: {state.error}</Text>}

        {dev.overlay}

        {!working && (
          <Box>
            <Text color="green">› </Text>
            <TextInput
              placeholder="type a question, ctrl-c to stop"
              onSubmit={(q: string) => {
                if (q.trim()) dispatch({ type: "submit_query", query: q });
              }}
            />
          </Box>
        )}
      </Box>
    </>
  );
}

export function renderCli(
  bus: EventBus<WorkflowEvent>,
  dispatch: (c: Command) => void,
  bootstrap: readonly WorkflowEvent[],
): () => void {
  // ctrl+c is the app's to handle — it says `quit` on the wire so the harness ends and the process with it. Left
  // to Ink, ctrl+c unmounts the view and nothing tells the harness, which waits for a command that never comes.
  const instance = render(
    <View bus={bus} dispatch={dispatch} bootstrap={bootstrap} />,
    { exitOnCtrlC: false },
  );
  return () => instance.unmount();
}
