/** The Ask moment: what a brief can draw on, how deep it goes, which shape it takes, and the library of
 *  settled briefs beside it. */
import { type AppState, type DocState, type LibraryEntry } from "../state.js";
import { BUDGETS, type Effort } from "../../harness/budgets.js";
import { type Pace } from "../pace.js";
import { activeDoc, runDoc } from "./canvas.js";

/** One source the brief can draw on: an installed ability. `included` is whether it takes part in the next
 *  ask; the composer's chips toggle it. */
export interface Source {
  name: string;
  title: string;
  detail: string | null;
  included: boolean;
  /** The ability's own mark, when its manifest names one. */
  iconUrl?: string;
  /** In the registry — its factory ran, so it can actually be drawn on. */
  enabled: boolean;
  /** Required config keys with no stored value. Non-empty ⇒ the ability is
   *  installed but cannot be enabled until they are set, which is a different
   *  thing from a user having excluded it. */
  needs: string[];
  /** Its config surface, derived from the ability's OWN schema — nothing here
   *  knows what a corpus or an API key is, which is what lets a harness render
   *  config for an ability it has never seen. */
  fields: AbilityField[];
}

export interface AbilityField {
  key: string;
  /** JSON Schema type; decides the input. */
  type: string;
  required: boolean;
  /** `x-secret` — write-only. Never rendered, only replaced. */
  secret: boolean;
  /** A value is stored. Key-presence only: the value never leaves the host,
   *  so the form can say "stored" but can never show it. */
  set: boolean;
}

type ConfigSchema = {
  properties?: Record<string, { type?: string; "x-secret"?: boolean } | undefined>;
  required?: string[];
};

const fieldsOf = (
  schema: unknown,
  config: Record<string, unknown>,
): AbilityField[] => {
  const s = schema as ConfigSchema | undefined;
  const required = new Set(s?.required ?? []);
  return Object.entries(s?.properties ?? {}).map(([key, prop]) => ({
    key,
    type: typeof prop?.type === "string" ? prop.type : "string",
    required: required.has(key),
    secret: prop?.["x-secret"] === true,
    set: key in config,
  }));
};

/** EVERY installed ability — see the wire notes on abilities:state. */
export const selectSources = (app: AppState): Source[] =>
  app.session.abilities
    .map((a) => ({
      name: a.name,
      // The ability's own name — as a chip beside its siblings the bare
      // name is what identifies it, and it stays true for an ability this
      // harness has never heard of.
      title: a.name,
      detail:
        a.name === "corpus" && app.session.corpusStatus
          ? `${app.session.corpusStatus.fileCount} files`
          : null,
      included: app.session.participation[a.name] !== false,
      iconUrl: a.iconUrl,
      enabled: a.enabled,
      needs: ((a.configSchema as { required?: string[] } | undefined)?.required ?? [])
        .filter((k) => !(k in a.config)),
      fields: fieldsOf(a.configSchema, a.config),
    }));

/** Depth, in the product's voice — the minutes are priced per plan by
 *  `estimateLabel`, never flat. */
export const DEPTHS: readonly { depth: Effort; title: string }[] = [
  { depth: "low", title: "Quick" },
  { depth: "medium", title: "Standard" },
  { depth: "high", title: "Thorough" },
];

/** Minutes for the picker, from the machine's pace (`paceFor` — a stated
 *  prior until a brief of this depth and shape has settled): inquiries at
 *  the per-task rate plus the settling pass. The plan's task count is
 *  clamped to each depth's own breadth — a depth never quotes more
 *  inquiries than it would actually run. No plan yet → the preset's
 *  breadth. Pure: pace arrives as an argument so the seam stays
 *  derivation-only. */
export const estimateLabel = (depth: Effort, tasks: number | null, pace: Pace): string => {
  const breadth = BUDGETS.effort[depth].maxTasks;
  const n = Math.min(tasks ?? breadth, breadth);
  return `~${Math.max(1, Math.round((pace.perTaskMs * n + pace.synthMs) / 60_000))} min`;
};

export const selectDepth = (app: AppState): Effort =>
  app.session.config?.defaults.effort ?? "high";

/** The RUNNING run's depth. The config default can be retoggled mid-run
 *  (that is what the depth chips edit); time math keys off the effort the
 *  run was actually submitted at. */
export const depthOf = (app: AppState, d: DocState): Effort =>
  d.runEffort ?? app.session.config?.defaults.effort ?? "high";
export const selectRunDepth = (app: AppState): Effort => depthOf(app, runDoc(app) ?? activeDoc(app));

/** How a brief is worked, as document characters (flat/deep stay wire-only).
 *  `ask` is not a plan shape at all — it skips the planner and puts ONE agent
 *  over every ability, which is why it carries `direct` rather than a mode of
 *  its own. It rides `flat` on the wire because a single task has no order to
 *  disagree about. */
export type Shape = "survey" | "investigate" | "ask";

export const SHAPES: readonly {
  shape: Shape;
  mode: "flat" | "deep";
  /** Skips the planner: the question IS the plan. */
  direct?: boolean;
  title: string;
  detail: string;
}[] = [
  // Ordered by what they cost the reader: one answer, then several lenses at
  // once, then a chain that builds. Nothing indexes this table — the order is
  // the picker's reading order and nothing else.
  { shape: "ask", mode: "flat", direct: true, title: "Ask", detail: "one agent, every ability — straight answer" },
  { shape: "survey", mode: "flat", title: "Survey", detail: "independent lenses, side by side" },
  { shape: "investigate", mode: "deep", title: "Investigate", detail: "each step builds on the last" },
];

/** The configured default. Only a plan shape can be a default: `reasoningMode`
 *  has no value for `ask`, which is chosen per run and never persisted. */
export const selectShape = (app: AppState): Shape =>
  (app.session.config?.defaults.reasoningMode ?? "flat") === "deep" ? "investigate" : "survey";

/** The shape of the run in flight (the submitted mode), not the config
 *  default — the pace record and the eta both speak about THIS run. A direct
 *  run rides `flat`, so the mode alone would call an ask a Survey. */
export const shapeOf = (d: DocState): Shape =>
  d.direct ? "ask" : d.mode === "deep" ? "investigate" : "survey";
export const selectRunShape = (app: AppState): Shape => shapeOf(runDoc(app) ?? activeDoc(app));

export interface Boot {
  state: "quiet" | "loading";
  loadingLabel: string | null;
}

export const selectBoot = (app: AppState): Boot => ({
  state: app.session.phase === "boot" && app.session.loadingLabel !== null ? "loading" : "quiet",
  loadingLabel: app.session.loadingLabel,
});

/** Every settled brief on disk, newest first. Opening one restores it as
 *  the session document — no body is ever held view-side. */
export const selectLibrary = (app: AppState): LibraryEntry[] => app.session.library.entries;

/** The live library search, when one is running: its query and the report
 *  paths ranked best-first by the session reranker. */
export const selectLibrarySearch = (app: AppState): { query: string; ranked: string[] } | null =>
  app.session.librarySearch;
