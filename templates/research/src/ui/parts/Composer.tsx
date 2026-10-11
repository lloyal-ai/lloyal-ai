/** The docked composer: one field, the run's clock, depth priced in honest
 *  minutes for the plan at hand, send. It answers the planner when the
 *  planner asked; otherwise it opens a brief in the chosen shape. Over a
 *  settled brief it carries the Ask/Extend choice: Ask answers from the
 *  warm context (skipPlanner — instant); Extend reframes fully as a new
 *  run. A depth chosen here applies from the next run. */
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import pcmWorkletUrl from "@lloyal-labs/ui/pcm-worklet?url&no-inline";
import { color, font, radius, shadow } from "../theme.js";
import { MicGlyph, Popover, RecordingWaveform, useContentOrigin, useProjection, useSend, useVoiceInput } from "@lloyal-labs/ui";
import type { Command } from "../../protocol.js";
import { ingestMedia, representationUrl } from "@lloyal-labs/media";
import { resolveAsset } from "./Figures.js";
import type { Descriptor } from "@lloyal-labs/media";
import {
  DEPTHS, SHAPES, fmtElapsed, selectAbilitiesKnown, selectActiveDocId, selectBanked,
  selectDepth, selectSources, selectLive, selectMoment, selectResumedAt, selectRevision,
  type Shape, type Source,
} from "../select.js";
import type { AppState } from "../state.js";

// Stable identities — the composer re-renders per keystroke, and a fresh
// inline closure per render would grow the fold's memo map (store contract).
const selectSettled = (app: AppState): boolean => selectMoment(app) === "settle";
const selectActiveAsk = (app: AppState): string | null =>
  app.activeDocId !== null ? app.documents.get(app.activeDocId)?.ask ?? null : null;
const selectClarifying = (app: AppState): boolean =>
  app.activeDocId !== null &&
  app.documents.get(app.activeDocId)?.phase === "clarifying";

/** A HINT for the file picker, not a gate — drag-and-drop and paste bypass it,
 *  and the host's ingress is the only thing that decides what is admitted.
 *  Enumerating types here would be a second copy of a question the bytes
 *  answer — and wrong in both directions (the ingress converts and admits
 *  webp, heic and tiff happily). */
const ATTACH_TYPES = "image/*,application/pdf";

/** An attachment is admitted the moment it is picked: the bytes cross HTTP
 *  once, the host normalizes an image or reads a document, and the tray shows
 *  the ADMITTED thing — an image's admitted pixels, a document's first page —
 *  rather than a local preview that may not be what the model gets. Submit
 *  then carries roots only, and a refused file says so before the question
 *  is even written. A removed attachment leaves an unreferenced blob behind,
 *  the same harmless orphan class the store's write order already accepts. */
type Attached =
  | { id: number; name: string; status: "uploading" }
  | { id: number; name: string; status: "admitted"; root: Descriptor; kind: "image" | "document"; thumb: string | null; title: string | null }
  | { id: number; name: string; status: "failed"; error: string };

/** Hover and pressed states inline styles cannot express. A selected pill's
 *  inline background always beats the hover class, so selection never dims. */
const CSS = `
  .cmp-send { transition: background .12s ease, transform .06s ease; }
  .cmp-send:hover:not(:disabled) { background: ${color.emberDeep}; }
  .cmp-send:active:not(:disabled) { transform: scale(.94); }
  .cmp-send:disabled { opacity: .55; cursor: default; }
  .cmp-icon { transition: background .12s ease, color .12s ease; }
  .cmp-icon:hover:not(:disabled) { color: ${color.ink}; background: ${color.card2}; }
  .cmp-icon:disabled { opacity: .45; cursor: default; }
  .cmp-mic { transition: background .12s ease, color .12s ease; }
  .cmp-mic:hover:not(:disabled) { background: ${color.line}; }
  .cmp-mic:disabled { opacity: .45; cursor: default; }
  .cmp-stop { transition: background .12s ease; }
  .cmp-stop:hover { background: ${color.dim}; }
  .cmp-spin { width: 10px; height: 10px; border-radius: 50%; flex: none; box-sizing: border-box;
    border: 1.5px solid ${color.line}; border-top-color: ${color.dim}; animation: cmp-spin .9s linear infinite; }
  @keyframes cmp-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .cmp-spin { animation: fn-pulse 2.4s ease-in-out infinite; } }
  .cmp-pill { transition: background .12s ease, color .12s ease; }
  .cmp-pill:hover { background: ${color.card}; color: ${color.ink}; }
  .cmp-menu-main { transition: background .12s ease; }
  .cmp-menu-main:hover, .cmp-menu-main:focus-visible { background: ${color.card2}; outline: 0; }
`;

/** A page with a folded corner — the document chip's glyph. */
function DocGlyph(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function Composer({ shape, placeholder }: {
  shape: Shape;
  placeholder: string;
}): ReactElement {
  const send = useSend<Command>();
  const origin = useContentOrigin();
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  const [imageError, setImageError] = useState("");
  const uploading = images.some((a) => a.status === "uploading");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const draftInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  /** The question, held after send until the fold acknowledges it. The echo
   *  mints or names a document within milliseconds, so the first clear arm
   *  (the active doc changed) does nearly all the work; a warm ask clears on
   *  its own echo, a clarify answer on leaving 'clarifying'. */
  const [pending, setPending] = useState<
    { text: string; docId: string | null; clarify: boolean } | null>(null);
  /** An ability just saved toward its first enable — its pill pulses until
   *  `abilities:state` confirms (a corpus enable INDEXES, which takes time). */
  const [enabling, setEnabling] = useState<string | null>(null);
  const depth = useProjection(selectDepth);
  const live = useProjection(selectLive);
  const settled = useProjection(selectSettled);
  const activeDocId = useProjection(selectActiveDocId);
  const clarifying = useProjection(selectClarifying);
  const revision = useProjection(selectRevision);
  // What submit() will actually send — the render gates below share the
  // same truth instead of re-deriving it.
  const willSkipPlanner = settled ? true : shape === "ask";
  const sources = useProjection(selectSources);
  const abilitiesKnown = useProjection(selectAbilitiesKnown);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const configPanel = sources.find((l) => l.name === configFor) ?? null;
  const askNow = useProjection(selectActiveAsk);
  /** Dictation lives in the question row: the mic beside the field, and while
   *  it records the field itself gives way to the waveform. A transcript lands
   *  as editable text at the cursor and the field takes focus so the next
   *  keystroke edits or sends it; nothing is submitted on the reader's behalf. */
  const dictated = useRef(false);
  const voice = useVoiceInput({
    workletUrl: pcmWorkletUrl,
    draft,
    onDraft: (text) => { dictated.current = true; setDraft(text); },
    selection: () => ({
      start: draftInput.current?.selectionStart ?? draft.length,
      end: draftInput.current?.selectionEnd ?? draft.length,
    }),
    destination: `${activeDocId ?? "new"}:${clarifying ? revision : "ask"}`,
    disabled: uploading || pending !== null,
  });
  // The field returns once dictation ends; a transcript that just landed hands it focus.
  useEffect(() => {
    if (voice.active || !dictated.current) return;
    dictated.current = false;
    draftInput.current?.focus();
  }, [draft, voice.active]);
  // Escape abandons a recording from anywhere in the window: the field that
  // would normally take the key is replaced by the waveform while it records.
  const cancelVoice = useRef(voice.cancel);
  cancelVoice.current = voice.cancel;
  useEffect(() => {
    if (!voice.active) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") cancelVoice.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voice.active]);

  // Acknowledgment: a document was born or activated (the echo lands in
  // milliseconds), the warm ask echoed, or the clarify round moved on.
  useEffect(() => {
    if (pending === null) return;
    if (
      activeDocId !== pending.docId ||
      askNow === pending.text ||
      (pending.clarify && !clarifying)
    ) {
      setPending(null);
    }
  }, [pending, activeDocId, askNow, clarifying]);
  // The echo must not outlive plausibility — a dead wire has its own banner.
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 12_000);
    return () => clearTimeout(t);
  }, [pending]);
  useEffect(() => {
    if (enabling !== null && sources.find((l) => l.name === enabling)?.enabled) {
      setEnabling(null);
    }
  }, [enabling, sources]);

  const closeConfig = (): void => {
    setConfigFor(null);
    setValues({});
  };
  const openConfig = (name: string): void => {
    setConfigFor((open) => (open === name ? null : name));
    setValues({});
  };
  /** Only what was typed is sent: a stored value is never echoed back to the
   *  form (the wire carries key-presence, not values), so an untouched field
   *  must not be submitted as an empty string and wipe it. */
  const saveConfig = (): void => {
    if (!configPanel) return;
    const entries = Object.entries(values).filter(([, v]) => v.trim() !== "");
    if (entries.length > 0) {
      send({
        type: "set_ability_config",
        name: configPanel.name,
        values: Object.fromEntries(entries),
      });
      if (!configPanel.enabled) setEnabling(configPanel.name);
    }
    closeConfig();
  };

  /** The abilities fold into one chip when they would not fit beside the depth
   *  picker. The fit is measured against what the row would need at natural
   *  width, held out of sight below, so nothing flips as the chip itself
   *  changes the row. */
  const controlRow = useRef<HTMLDivElement>(null);
  const measurer = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [chip, setChip] = useState<HTMLButtonElement | null>(null);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);
  const closeAbilities = (): void => setAbilitiesOpen(false);
  useLayoutEffect(() => {
    const row = controlRow.current;
    const need = measurer.current;
    if (!row || !need) return;
    const fit = (): void => {
      const [pills, picker] = Array.from(need.children) as HTMLElement[];
      setCollapsed(pills.offsetWidth + 10 + (picker?.offsetWidth ?? 0) > row.clientWidth);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [sources, abilitiesKnown, willSkipPlanner, live, voice.active]);
  // The menu belongs to the chip: when the chip goes, so does the menu.
  useEffect(() => { if (!collapsed || voice.active) setAbilitiesOpen(false); }, [collapsed, voice.active]);
  /** Arrow keys walk the rows; Enter and Space act on the row under focus, as on any menu. */
  const moveInMenu = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? items[(at + 1) % items.length]
      : e.key === "ArrowUp" ? items[(at - 1 + items.length) % items.length]
      : e.key === "Home" ? items[0] : items[items.length - 1];
    next?.focus();
    e.preventDefault();
  };
  /** One ability, as a pill in the row or as a row in the menu: the same
   *  toggle, the same settings cog, the same meaning of dim. An ability that
   *  has never been configured is not "excluded" — it CANNOT run yet, so its
   *  body opens its settings rather than offering a toggle that could not do
   *  anything. Every ability that HAS settings shows the cog, configured or
   *  not — one that silently lacks it reads as a different kind of thing. */
  const ability = (l: Source, variant: "pill" | "row"): ReactElement => {
    const blocked = !l.enabled;
    const on = l.included && !blocked;
    const inMenu = variant === "row";
    const settings = (): void => { if (inMenu) closeAbilities(); openConfig(l.name); };
    const main = (
      <button
        type="button"
        role={inMenu ? "menuitemcheckbox" : undefined}
        className={inMenu ? "cmp-menu-main" : undefined}
        style={{ ...(inMenu ? S.menuMain : S.libMain), ...(blocked ? S.libBlocked : null) }}
        aria-pressed={!inMenu && !blocked ? l.included : undefined}
        aria-checked={inMenu && !blocked ? l.included : undefined}
        aria-expanded={!inMenu && blocked ? configFor === l.name : undefined}
        title={
          blocked
            ? `Needs ${l.needs.join(", ") || "configuration"} — click to set it`
            : l.included
              ? "Leave this out of the next brief"
              : "Include it again"
        }
        onClick={() => (blocked ? settings() : send({ type: "toggle_participation", name: l.name }))}
      >
        {inMenu && (
          <span style={S.menuTick} aria-hidden="true">
            {on && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L19 7" />
              </svg>
            )}
          </span>
        )}
        {l.iconUrl ? (
          <img src={l.iconUrl} alt="" width={12} height={12} style={S.libIcon} />
        ) : (
          <span
            className={enabling === l.name ? "fn-lamp" : undefined}
            style={{ ...S.libDot, ...(on || enabling === l.name ? null : S.libDotOff) }}
          />
        )}
        {l.title}
        {l.detail ? ` · ${l.detail}` : ""}
      </button>
    );
    const gear = l.fields.length > 0 && (
      <button
        type="button"
        className="cmp-icon" style={inMenu ? S.menuGear : S.libGear}
        title={`${l.title} settings`}
        aria-label={`${l.title} settings`}
        aria-expanded={configFor === l.name}
        onClick={settings}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008 3.6 1.65 1.65 0 009 2.09V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.4 8v0a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
    );
    return inMenu ? (
      <div key={l.name} style={{ ...S.menuRow, ...(on ? null : S.libOff) }}>
        {main}
        {gear && <span style={S.menuRule} aria-hidden="true" />}
        {gear}
      </div>
    ) : (
      <span key={l.name} style={{ ...S.lib, ...(on ? null : S.libOff) }}>
        {main}
        {gear}
      </span>
    );
  };
  /** Depth, by name alone: the words say how much work, and the plan that
   *  follows says how long. */
  const depthPicker = (): ReactElement => (
    <div style={S.depths} role="radiogroup" aria-label="Depth">
      {DEPTHS.map((d) => (
        <button
          key={d.depth}
          type="button"
          role="radio"
          aria-checked={d.depth === depth}
          className="cmp-pill" style={d.depth === depth ? S.depthOn : S.depth}
          onClick={() => send({ type: "set_config", patch: { defaults: { effort: d.depth } } })}
        >
          {d.title}
        </button>
      ))}
    </div>
  );

  // No size check here: the host bounds an upload in size and in time, and a second opinion in the view
  // would only drift from the one that counts.
  /** Takes anything File-shaped so the picker and the clipboard feed ONE path
   *  — a second attach path is how the two drift. */
  const attach = (files: ArrayLike<File> | null): void => {
    setImageError("");
    // Copy the list BEFORE resetting the picker: a FileList is live, and
    // clearing the input empties it.
    const chosen = Array.from(files ?? []);
    if (picker.current) picker.current.value = "";
    if (chosen.length === 0) return;
    if (origin === null) {
      setImageError("This build cannot accept attachments.");
      return;
    }
    for (const file of chosen) {
      const id = nextId.current++;
      setImages((prev) => [...prev, { id, name: file.name, status: "uploading" }]);
      void (async () => {
        try {
          const root = await ingestMedia(origin, new Uint8Array(await file.arrayBuffer()));
          const asset = await resolveAsset(origin, root.digest);
          const cover = asset.kind === "document" ? asset.meta.pages.find((p) => p.page === 1)?.render : undefined;
          const thumb = asset.kind === "image"
            ? representationUrl(origin, root.digest)
            : cover ? representationUrl(origin, cover.digest) : null;
          const title = asset.kind === "document" ? asset.meta.title : null;
          setImages((prev) => prev.map((a) => (a.id === id ? { id, name: file.name, status: "admitted", root, kind: asset.kind, thumb, title } : a)));
        } catch (err) {
          // The host's own message — 413 too large, 408 too slow, 400 not
          // admitted — beats anything invented here.
          const error = err instanceof Error ? err.message : "Upload failed.";
          setImages((prev) => prev.map((a) => (a.id === id ? { id, name: file.name, status: "failed", error } : a)));
        }
      })();
    }
  };

  /** Paste is the shortest road from a screenshot to a question. The clipboard
   *  hands over the same File objects the picker does, so it feeds `attach`
   *  rather than growing a second path. Only image and PDF items are taken,
   *  and the default is prevented only when one was — otherwise a paste
   *  carrying text would silently lose it. */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === "file" && (i.type.startsWith("image/") || i.type === "application/pdf"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    attach(files);
  };

  /** Drop is the third road in, and it feeds the same `attach`. Only a file
   *  drag lights the composer up — dragging selected text must not look like
   *  it will attach something. */
  const dragged = (e: DragEvent<HTMLDivElement>): boolean =>
    e.dataTransfer.types.includes("Files");

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!dragged(e)) return;
    e.preventDefault();
    setDragging(false);
    attach(e.dataTransfer.files);
  };

  // A file dropped anywhere else would navigate the window to it — a blank app
  // on desktop, the file itself in a browser. Swallowing both events app-wide
  // makes a stray drop do nothing, and `dragover` is also what MAKES the
  // composer a valid drop target.
  useEffect(() => {
    const swallow = (e: Event): void => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const clear = (): void => {
    setDraft("");
    setImages([]);
    setImageError("");
  };

  const submit = (): void => {
    const text = draft.trim();
    // Enter is the only way to submit, so re-entry is one keypress away while
    // an upload is in flight — and a second submit would upload the same files
    // again and send a second query.
    if (!text || uploading || pending !== null) return;
    if (clarifying) {
      send({ type: "submit_clarification", revision, answer: text });
      setPending({ text, docId: activeDocId, clarify: true });
      clear();
      return;
    }
    // A refused attachment is not silently dropped from the question: the
    // user removes it, or retries it, before sending.
    if (images.some((a) => a.status === "failed")) {
      setImageError("Remove the attachment that was refused, or attach it again.");
      return;
    }
    const mode = SHAPES.find((s) => s.shape === shape)?.mode ?? "flat";
    // The bytes already crossed HTTP at attach time; only the roots go over
    // the socket.
    const attachments = images.flatMap((a) => (a.status === "admitted" ? [a.root] : []));
    send({
      type: "submit_query", query: text, mode,
      // Cold: the Ask shape is the choice. Warm: every follow-up is an
      // ask — one agent, every ability, into the settled document.
      skipPlanner: willSkipPlanner,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    setPending({ text, docId: activeDocId, clarify: false });
    clear();
  };

  return (
    <div
      style={{ ...S.shell, ...(dragging ? S.shellDrop : null) }}
      onDragOver={(e) => { if (dragged(e)) { e.preventDefault(); setDragging(true); } }}
      // Dragging over a CHILD fires dragleave on the parent; only a leave that
      // actually exits the composer should drop the highlight.
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      <style>{CSS}</style>
      {(images.length > 0 || imageError) && (
        <div style={S.tray}>
          {images.map((img) => (
            <span key={img.id} style={S.thumb} title={img.status === "admitted" && img.title ? img.title : img.name}>
              {img.status === "admitted" && img.thumb
                ? <img src={img.thumb} alt={img.title ?? img.name} style={S.thumbImg} />
                : img.status === "failed"
                  ? <span style={{ ...S.docChip, color: color.danger }}><DocGlyph />{img.name} — {img.error}</span>
                  : <span style={{ ...S.docChip, ...(img.status === "uploading" ? S.admitting : {}) }}><DocGlyph />{img.name}{img.status === "uploading" ? " · admitting…" : ""}</span>}
              <button
                type="button"
                style={S.thumbX}
                aria-label={`Remove ${img.name}`}
                onClick={() => setImages((prev) => prev.filter((p) => p.id !== img.id))}
              >
                ×
              </button>
            </span>
          ))}
          {imageError && <span style={S.imageError}>{imageError}</span>}
        </div>
      )}
      {configPanel && (
        <div style={S.config} role="group" aria-label={`${configPanel.title} settings`}>
          <div style={S.configHead}>
            <b style={S.configName}>{configPanel.title}</b>
            <span style={S.configNeed}>
              {configPanel.needs.length > 0
                ? `needs ${configPanel.needs.join(", ")}`
                : "settings"}
            </span>
          </div>
          {configPanel.fields.map((f) => (
            <label key={f.key} style={S.configRow}>
              <span style={S.configKey}>
                {f.key}
                {f.required && <span style={S.configReq}>required</span>}
              </span>
              <input
                style={S.configInput}
                type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "new-password" : "off"}
                // A stored value is never echoed to the form — the wire carries
                // key-presence, not values — so the placeholder says which it is.
                placeholder={f.set ? "stored — type to replace" : "not set"}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
              />
            </label>
          ))}
          {configPanel.fields.some((f) => f.secret) && (
            <p style={S.configNote}>
              Sent to the host running the model, and stored there.
            </p>
          )}
          <div style={S.configActions}>
            <button type="button" className="cmp-pill" style={S.configCancel} onClick={closeConfig}>
              Cancel
            </button>
            <button type="button" style={S.configSave} onClick={saveConfig}>
              {configPanel.enabled ? "Save" : "Enable"}
            </button>
          </div>
        </div>
      )}
      <div style={{ ...S.composer, ...(voice.active ? S.composerDictating : null) }}>
      <input
        ref={picker}
        type="file"
        accept={ATTACH_TYPES}
        multiple
        style={{ display: "none" }}
        onChange={(e) => attach(e.target.files)}
      />
      <div style={{ ...S.stack, ...(voice.active ? S.stackDictating : null) }}>
      {/* Row 1 — the question, and only what acts on it. While dictation holds
          the microphone the same row carries it: cancel where attach was, the
          waveform where the words will go, stop where the mic was. */}
      <div style={S.entryRow}>
        {voice.active ? (
          <button
            type="button"
            className="cmp-icon" style={S.attach}
            title="Cancel dictation (Esc)"
            aria-label="Cancel dictation"
            onClick={voice.cancel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="cmp-icon" style={S.attach}
            title="Attach an image or PDF"
            aria-label="Attach an image or PDF"
            onClick={() => picker.current?.click()}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3 3 0 014.24 4.24l-8.49 8.49a1 1 0 01-1.41-1.41l7.78-7.78" />
            </svg>
          </button>
        )}
        {voice.active ? (
          <div style={S.dictation}>
            <RecordingWaveform levels={voice.levels} elapsed={voice.elapsed} recording={voice.phase === "recording"} />
            {voice.phase !== "recording" && (
              <span role="status" style={S.dictationStatus}>
                {voice.phase === "requesting" ? "Allow microphone access" : "Transcribing…"}
              </span>
            )}
          </div>
        ) : (
          <input
            ref={draftInput}
            style={{ ...S.input, ...(pending ? S.inputSent : null) }}
            value={pending ? pending.text : draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            }}
            onPaste={onPaste}
            // A failed recording explains itself where the words would have
            // gone, and the first keystroke replaces it.
            placeholder={voice.error ?? (uploading ? "Sending your image…" : placeholder)}
            disabled={uploading || pending !== null}
          />
        )}
        {pending && <span className="fn-lamp" style={S.sentDot} />}
        {live && <Clock />}
        {voice.pending && (
          <button type="button" className="cmp-pill" style={S.insertTranscript} onClick={voice.insertPending}>
            Insert transcript
          </button>
        )}
      </div>
      {/* Row 2 — what the next brief will DRAW ON, then how it will be worked.
          Both were elsewhere before: participation only on the landing, where it
          vanished the moment a run started, and depth crowded onto the question
          row. They belong together, and in the dock they are reachable at every
          moment rather than only the first. While a recording is in hand the row
          steps aside: the card keeps its height and becomes the one line the
          recording needs. When the abilities do not fit beside the depth picker
          they fold into one chip whose menu carries the same toggles and
          settings; the fit is measured below, never guessed from a breakpoint. */}
      {!voice.active && <div ref={controlRow} style={S.controlRow}>
        <div style={S.libs}>
          {/* The pills' place is held while the host is still saying which
              abilities exist, so they arrive into a slot rather than pushing
              the row around. */}
          {!abilitiesKnown && (
            <span style={{ ...S.lib, ...S.libOff }} role="status" aria-label="Loading abilities">
              <span className="cmp-spin" aria-hidden="true" />
              abilities
            </span>
          )}
          {abilitiesKnown && (collapsed ? (
            <button
              type="button"
              ref={setChip}
              className="cmp-pill" style={{ ...S.lib, ...S.chip }}
              aria-haspopup="menu"
              aria-expanded={abilitiesOpen}
              title="Abilities for the next brief"
              onClick={() => setAbilitiesOpen((o) => !o)}
            >
              <span style={S.chipDots} aria-hidden="true">
                {sources.map((l) => (
                  <span key={l.name} style={{ ...S.libDot, ...(l.included && l.enabled ? null : S.libDotOff) }} />
                ))}
              </span>
              abilities
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
          ) : sources.map((l) => ability(l, "pill")))}
        </div>
        <span style={{ flex: 1 }} />
        {/* Depth sets how many inquiries run and how long they may work. An ask
            runs exactly one agent to a straight answer, so there is no breadth to
            choose. The configured effort still bounds the agent; it is simply not
            a question worth asking here. While a brief is live the pills go too: a
            depth chosen then would only be the next ask's. */}
        {!willSkipPlanner && !live && depthPicker()}
      </div>}
      {/* What the row would need at its natural width: the pills and the picker,
          out of sight and out of reach. The fit is a measurement of these. */}
      <div ref={measurer} aria-hidden="true" inert style={S.measure}>
        <div style={S.libsNowrap}>{sources.map((l) => ability(l, "pill"))}</div>
        {!willSkipPlanner && !live ? depthPicker() : <div />}
      </div>
      <Popover anchor={chip} open={abilitiesOpen} onClose={closeAbilities} label="Abilities">
        <div role="menu" aria-label="Abilities for the next brief" style={S.menu} onKeyDown={moveInMenu}>
          {sources.map((l) => ability(l, "row"))}
        </div>
      </Popover>
      </div>
      {/* The mic sits beside send, the same size: the two ways a question leaves
          the composer. It has its place from first paint, off until the host
          says dictation exists, and only a harness with no transcription at
          all goes without it. While recording, stop takes its seat. */}
      {voice.enabled !== false && (voice.phase === "recording" ? (
        <button type="button" className="cmp-stop" style={S.stop} title="Stop recording" aria-label="Stop recording" onClick={voice.stop}>
          <span aria-hidden="true" style={S.stopMark} />
        </button>
      ) : (
        <button
          type="button"
          className="cmp-mic" style={S.mic}
          title={voice.enabled ? "Dictate" : "Dictation is starting"}
          aria-label="Record voice"
          disabled={!voice.available || voice.active}
          onClick={voice.start}
        >
          <MicGlyph size={18} />
        </button>
      ))}
      <button type="button" className="cmp-send" style={S.send} onClick={submit} aria-label="Send" disabled={uploading || pending !== null || voice.active}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
      </div>
    </div>
  );
}

/** The run's wall clock, ticking beside the picker while work is live.
 *  Wall time is composed here, not in a selector — the fold's memo would
 *  freeze a Date.now() between events. */
function Clock(): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const banked = useProjection(selectBanked);
  const resumedAt = useProjection(selectResumedAt);
  const elapsed = banked + (resumedAt !== null ? Math.max(0, now - resumedAt) : 0);
  return (
    <span style={S.clock}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {fmtElapsed(elapsed)}
    </span>
  );
}

const depthBase: CSSProperties = {
  font: `600 12px ${font.ui}`, padding: "5px 11px", borderRadius: 7,
  border: 0, background: "none", color: color.dim, cursor: "pointer",
};

const S: Record<string, CSSProperties> = {
  shell: { display: "flex", flexDirection: "column", gap: 8 },
  /** Outline, not border or padding: it must not move the composer as a file
   *  passes over it. */
  shellDrop: { outline: `2px dashed ${color.ember}`, outlineOffset: 6, borderRadius: radius.card },
  tray: {
    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    padding: "0 2px",
  },
  thumb: {
    position: "relative", display: "inline-flex", flex: "none",
    borderRadius: 8, border: `1px solid ${color.line}`, background: color.card,
    padding: 3, boxShadow: shadow.card,
  },
  thumbImg: {
    width: 40, height: 40, objectFit: "cover", borderRadius: 6, display: "block",
  },
  thumbX: {
    position: "absolute", top: -6, right: -6, width: 18, height: 18,
    borderRadius: 9, border: `1px solid ${color.line}`, background: color.card,
    color: color.dim, font: `600 12px ${font.ui}`, lineHeight: 1,
    display: "grid", placeItems: "center", cursor: "pointer", padding: 0,
  },
  /** An attachment the host has not answered for yet. */
  admitting: { opacity: 0.6 },
  docChip: {
    display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 10px 0 8px",
    font: `12px ${font.ui}`, color: color.ink, maxWidth: 240, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  imageError: { font: `12px ${font.ui}`, color: color.danger },
  attach: {
    width: 30, height: 30, borderRadius: 8, border: 0, background: "none",
    color: color.dim, display: "grid", placeItems: "center", flex: "none",
    cursor: "pointer", padding: 0,
  },
  composer: {
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.panel,
    boxShadow: shadow.card, padding: "12px 13px 10px",
    // Send sits beside the two rows and bottom-aligns with them, so it rides
    // the control row's line — the same baseline as the ability pills — rather
    // than floating in the card's vertical middle.
    display: "flex", alignItems: "flex-end", gap: 12,
  },
  /** Recording: the trailing controls centre on the single line instead of
   *  riding the control row's baseline. */
  composerDictating: { alignItems: "center" },
  stack: { display: "flex", flexDirection: "column", gap: 9, flex: 1, minWidth: 0, position: "relative" },
  /** What the control row would need at natural width, kept out of sight and
   *  out of reach; its children are measured, never shown. */
  measure: {
    position: "absolute", left: 0, top: 0, height: 0, overflow: "hidden", visibility: "hidden",
    pointerEvents: "none", display: "flex", gap: 10, whiteSpace: "nowrap",
  },
  libsNowrap: { display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", flex: "none" },
  /** The folded abilities: their dots, so state stays visible, and a chevron that says there is more. */
  chip: { gap: 7, color: color.ink, background: color.card2, cursor: "pointer" },
  chipDots: { display: "inline-flex", gap: 3, alignItems: "center" },
  menu: { display: "flex", flexDirection: "column", minWidth: 240 },
  menuRow: {
    display: "flex", alignItems: "stretch", gap: 2, borderRadius: 8,
    font: `500 12.5px ${font.ui}`, color: color.ink,
  },
  menuMain: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8,
    font: "inherit", color: "inherit", background: "none", border: 0, borderRadius: 8,
    padding: "8px 10px 8px 8px", cursor: "pointer", textAlign: "left",
  },
  /** The tick's seat is always there, so names line up whether a row is included or not. */
  menuTick: { width: 14, height: 14, display: "inline-grid", placeItems: "center", flex: "none", color: color.ember },
  menuRule: { width: 1, background: color.line, margin: "6px 4px", flex: "none" },
  menuGear: {
    background: "none", border: 0, padding: "0 10px 0 6px", cursor: "pointer", color: color.dim,
    display: "inline-flex", alignItems: "center", flex: "none", borderRadius: 8,
  },
  /** The two rows' height (38 + 9 + 32) held by the one row that remains, so
   *  the card does not breathe when a recording starts or ends. */
  stackDictating: { minHeight: 79, justifyContent: "center" },
  /** The question and the two controls that act on it. The row carries its
   *  own height so the field has room to breathe. */
  entryRow: { display: "flex", alignItems: "center", gap: 12, minHeight: 38 },
  /** What the brief draws on, then how it is worked — sources left, shape of
   *  the work right, reading in the order the decisions are actually made. */
  /** Holds the depth picker's own height whether or not the picker is there, so
   *  the card is the same size in every mode and the send button never moves. */
  controlRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0, minHeight: 32 },
  libs: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 },
  lib: {
    font: `500 11.5px ${font.ui}`, color: color.ink, background: color.card2,
    border: 0, borderRadius: 8, padding: "4px 9px", cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 6, flex: "none",
  },
  /** Excluded reads as quieter, never fainter than `dim` — it is still a
   *  control, and the dot goes hollow so the state survives a mono palette. */
  libOff: { color: color.dim, background: "none" },
  libDot: { width: 6, height: 6, borderRadius: "50%", background: color.ember, flex: "none" },
  libDotOff: { background: "none", boxShadow: `inset 0 0 0 1.5px ${color.dim}` },
  /** The toggle half of a chip. The chip itself is a container now, because a
   *  settings button cannot nest inside a button. */
  libMain: {
    font: "inherit", color: "inherit", background: "none", border: 0, padding: 0,
    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
  },
  libGear: {
    background: "none", border: 0, padding: 0, cursor: "pointer", color: color.dim,
    display: "inline-flex", flex: "none",
    marginLeft: 2, paddingLeft: 7, borderLeft: `1px solid ${color.line}`,
  },
  /** Installed but not runnable — reads as unavailable, not as switched off.
   *  Still a control: it opens the settings that would make it runnable. */
  libBlocked: { opacity: 0.62 },
  config: {
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.panel,
    boxShadow: shadow.card, padding: "12px 14px", marginBottom: 8,
    display: "flex", flexDirection: "column", gap: 9,
  },
  configHead: { display: "flex", alignItems: "baseline", gap: 8 },
  configName: { font: `600 13px ${font.ui}`, color: color.ink },
  configNeed: { font: `12px ${font.ui}`, color: color.dim },
  configRow: { display: "flex", alignItems: "center", gap: 10 },
  configKey: {
    font: `500 12px ${font.mono}`, color: color.dim, width: 132, flex: "none",
    display: "inline-flex", alignItems: "baseline", gap: 6,
  },
  configReq: { font: `10.5px ${font.ui}`, color: color.wait },
  configInput: {
    flex: 1, minWidth: 0, font: `13px ${font.ui}`, color: color.ink,
    background: color.card2, border: `1px solid ${color.line}`, borderRadius: 8,
    padding: "6px 9px", outline: 0,
  },
  configNote: { font: `11.5px ${font.ui}`, color: color.dim, margin: 0 },
  configActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  configCancel: {
    font: `500 12px ${font.ui}`, color: color.dim, background: "none",
    border: 0, borderRadius: 8, padding: "6px 11px", cursor: "pointer",
  },
  configSave: {
    font: `600 12px ${font.ui}`, color: color.ground, background: color.ink,
    border: 0, borderRadius: 8, padding: "6px 13px", cursor: "pointer",
  },
  /** An ability's own mark, when it names one. The dot is the fallback and
   *  also the state indicator, so an icon-bearing ability leans on the chip's
   *  own dimming to say whether it is included. */
  libIcon: { display: "block", flex: "none", borderRadius: 3 },
  input: {
    flex: 1, border: 0, outline: 0, font: `14.5px ${font.ui}`, color: color.ink,
    background: "none", minWidth: 0,
  },
  /** Words in hand, not yet taken — dimmed, beside a working lamp. */
  inputSent: { color: color.dim },
  /** The field's place while a recording is in hand: the waveform takes the
   *  width the words will take, in the same ink. */
  dictation: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, color: color.ink, font: `12px ${font.ui}` },
  dictationStatus: { color: color.dim, whiteSpace: "nowrap", flex: "none" },
  insertTranscript: {
    font: `600 12px ${font.ui}`, color: color.ink, background: color.card2,
    border: 0, borderRadius: 8, padding: "5px 10px", cursor: "pointer", flex: "none", whiteSpace: "nowrap",
  },
  /** Send's quiet twin: the same footprint on the card's second surface, ink glyph. */
  mic: {
    width: 33, height: 33, borderRadius: 9, border: 0, background: color.card2, color: color.ink,
    display: "grid", placeItems: "center", flex: "none", cursor: "pointer", padding: 0,
  },
  /** Stop is the mic's seat while recording: same footprint, filled so it reads as the live control. */
  stop: {
    width: 33, height: 33, borderRadius: 9, border: 0, background: color.ink, color: color.ground,
    display: "grid", placeItems: "center", flex: "none", cursor: "pointer", padding: 0,
  },
  stopMark: { width: 11, height: 11, borderRadius: 2.5, background: "currentColor", display: "block" },
  sentDot: { width: 7, height: 7, borderRadius: "50%", background: color.ember, flex: "none" },
  clock: {
    display: "inline-flex", alignItems: "center", gap: 5, flex: "none",
    font: `500 12px ${font.mono}`, color: color.dim, fontVariantNumeric: "tabular-nums",
  },
  depths: {
    display: "flex", gap: 3, background: color.card2, borderRadius: 9, padding: 3, flex: "none",
  },
  depth: depthBase,
  depthOn: { ...depthBase, background: color.ink, color: color.ground },
  send: {
    width: 33, height: 33, borderRadius: 9, background: color.ember, color: "#fff",
    border: 0, display: "grid", placeItems: "center", fontSize: 14, flex: "none", cursor: "pointer",
  },
};
