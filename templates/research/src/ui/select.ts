/** The domain seam. Everything above this speaks the brief's language — Moment, Section, Inquiry, Outline —
 *  and everything below it is `AppState`, the one fold every surface shares. Each selector is a pure derivation:
 *  nothing here is stored, dispatched or fetched. One module per moment of a brief's life, in the order a
 *  reader meets them; views import from this file. */
export * from "./select/canvas.js";
export * from "./select/inquiry.js";
export * from "./select/ask.js";
export * from "./select/frame.js";
export * from "./select/write.js";
export * from "./select/settle.js";
export * from "./select/rail.js";

// So a view never imports the fold directly.
export { extractStreamingReport } from "./state.js";
export type { AppState, AgentRuntime, TimelineItem } from "./state.js";
