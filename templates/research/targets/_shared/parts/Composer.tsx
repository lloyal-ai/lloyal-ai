/** The docked composer: one field, the run's clock, depth priced in honest
 *  minutes for the plan at hand, send. It answers the planner when the
 *  planner asked; otherwise it opens a brief in the chosen shape. Over a
 *  settled brief it carries the Ask/Extend choice: Ask answers from the
 *  warm context (skipPlanner — instant); Extend reframes fully as a new
 *  run. Depth applies on selection (`set_effort` — next run). */
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import { send, useBrief } from "../store.js";
import {
  DEPTHS, SHAPES, estimateLabel, fmtElapsed, selectActiveDocId, selectBanked,
  selectDepth, selectEtaTasks, selectLibraries, selectLive, selectMoment, selectResumedAt,
  type Shape,
} from "../select.js";
import { paceFor } from "../pace.js";
import type { AppState } from "../../../harness/state.js";

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
 *
 *  It used to enumerate four types, which was a fifth copy of a question the
 *  bytes answer, and wrong in both directions: it refused webp, heic and tiff,
 *  which the ingress converts and admits happily. */
const IMAGE_TYPES = "image/*";

/** A picked image, before submit.
 *
 *  `url` is a LOCAL object URL — an optimistic preview of the file the user
 *  chose, not of what the model will see. The two differ: normalization may
 *  re-encode, and the preview cannot be joined to the admitted representation
 *  by digest because the browser holds the source's hash while the fold holds
 *  the MANIFEST's. After submit the view resolves through the content plane
 *  instead, which shows the exact pixels the projector encoded. */
type Attached = { id: number; name: string; url: string; file: File };

/** Hover and pressed states inline styles cannot express. A selected pill's
 *  inline background always beats the hover class, so selection never dims. */
const CSS = `
  .cmp-send { transition: background .12s ease, transform .06s ease; }
  .cmp-send:hover:not(:disabled) { background: ${color.emberDeep}; }
  .cmp-send:active:not(:disabled) { transform: scale(.94); }
  .cmp-send:disabled { opacity: .55; cursor: default; }
  .cmp-icon { transition: background .12s ease, color .12s ease; }
  .cmp-icon:hover { color: ${color.ink}; background: ${color.card2}; }
  .cmp-pill { transition: background .12s ease, color .12s ease; }
  .cmp-pill:hover { background: ${color.card}; color: ${color.ink}; }
`;

export function Composer({ shape, placeholder }: {
  shape: Shape;
  placeholder: string;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
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
  const depth = useBrief(selectDepth);
  const live = useBrief(selectLive);
  const tasks = useBrief(selectEtaTasks);
  const settled = useBrief(selectSettled);
  const activeDocId = useBrief(selectActiveDocId);
  const clarifying = useBrief(selectClarifying);
  // What submit() will actually send — the render gates below share the
  // same truth instead of re-deriving it.
  const willSkipPlanner = settled ? true : shape === "ask";
  const libraries = useBrief(selectLibraries);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const configPanel = libraries.find((l) => l.name === configFor) ?? null;
  const askNow = useBrief(selectActiveAsk);

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
    if (enabling !== null && libraries.find((l) => l.name === enabling)?.enabled) {
      setEnabling(null);
    }
  }, [enabling, libraries]);

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

  // No size cap here any more. It existed because base64 inflated the wire by
  // 4/3 and the socket carried the bytes; the bytes now go over HTTP, where
  // the HOST bounds them — in size AND in time, which a client-side check
  // never did. Refusing here would only be a second, weaker opinion that
  // drifts from the one that counts.
  /** Takes anything File-shaped so the picker and the clipboard feed ONE path
   *  — a second attach path is how the two drift. */
  const attach = (files: ArrayLike<File> | null): void => {
    setImageError("");
    for (const file of Array.from(files ?? [])) {
      setImages((prev) => [
        ...prev,
        { id: nextId.current++, name: file.name, url: URL.createObjectURL(file), file },
      ]);
    }
    if (picker.current) picker.current.value = "";
  };

  /** Paste is the shortest road from a screenshot to a question. The clipboard
   *  hands over the same File objects the picker does, so it feeds `attach`
   *  rather than growing a second path. Only image items are taken, and the
   *  default is prevented only when one was — otherwise a paste carrying text
   *  would silently lose it. */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    attach(files);
  };

  const clear = (picked: Attached[]): void => {
    // Object URLs are a document-lifetime leak until revoked, and the preview
    // is over the moment the command is sent — after it the view resolves the
    // ADMITTED representation through the content plane.
    for (const i of picked) URL.revokeObjectURL(i.url);
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
      send({ type: "submit_clarification", answer: text });
      setPending({ text, docId: activeDocId, clarify: true });
      clear(images);
      return;
    }
    const mode = SHAPES.find((s) => s.shape === shape)?.mode ?? "flat";
    const picked = images;

    // Upload FIRST, send references second. The bytes cross HTTP where the
    // host normalizes, addresses and commits them; only the roots go over the
    // socket. Nothing is submitted if an upload fails — a query whose images
    // silently did not arrive is worse than one that did not start.
    void (async () => {
      let attachments;
      if (picked.length > 0) {
        const ingest = window.harness.ingestMedia;
        if (!ingest) {
          setImageError("This build cannot accept attachments.");
          return;
        }
        setUploading(true);
        try {
          attachments = await Promise.all(picked.map(async (i) =>
            ingest(new Uint8Array(await i.file.arrayBuffer()))));
        } catch (err) {
          // The host's own message — 413 too large, 408 too slow, 400 not a
          // readable image — beats anything invented here.
          setImageError(err instanceof Error ? err.message : "Upload failed.");
          return;
        } finally {
          setUploading(false);
        }
      }
      send({
        type: "submit_query", query: text, mode,
        // Cold: the Ask shape is the choice. Warm: every follow-up is an
        // ask — one agent, every ability, into the settled document.
        skipPlanner: willSkipPlanner,
        ...(attachments ? { attachments } : {}),
      });
      setPending({ text, docId: activeDocId, clarify: false });
      clear(picked);
    })();
  };

  return (
    <div style={S.shell}>
      <style>{CSS}</style>
      {(images.length > 0 || imageError) && (
        <div style={S.tray}>
          {images.map((img) => (
            <span key={img.id} style={S.thumb} title={img.name}>
              <img src={img.url} alt={img.name} style={S.thumbImg} />
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
      <div style={S.composer}>
      <input
        ref={picker}
        type="file"
        accept={IMAGE_TYPES}
        multiple
        style={{ display: "none" }}
        onChange={(e) => attach(e.target.files)}
      />
      <div style={S.stack}>
      {/* Row 1 — the question, and only what acts on it. */}
      <div style={S.entryRow}>
        <button
          type="button"
          className="cmp-icon" style={S.attach}
          title="Attach an image"
          aria-label="Attach an image"
          onClick={() => picker.current?.click()}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3 3 0 014.24 4.24l-8.49 8.49a1 1 0 01-1.41-1.41l7.78-7.78" />
          </svg>
        </button>
        <input
          style={{ ...S.input, ...(pending ? S.inputSent : null) }}
          value={pending ? pending.text : draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          onPaste={onPaste}
          placeholder={uploading ? "Sending your image…" : placeholder}
          disabled={uploading || pending !== null}
        />
        {pending && <span className="fn-lamp" style={S.sentDot} />}
        {live && <Clock />}
      </div>
      {/* Row 2 — what the next brief will DRAW ON, then how it will be worked.
          Both were elsewhere before: participation only on the landing, where it
          vanished the moment a run started, and depth crowded onto the question
          row. They belong together, and in the dock they are reachable at every
          moment rather than only the first. */}
      <div style={S.controlRow}>
        <div style={S.libs}>
          {libraries.map((l) => {
            // An ability that has never been configured is not "excluded" — it
            // CANNOT run yet, so its chip opens its settings rather than
            // offering a toggle that could not do anything.
            const blocked = !l.enabled;
            const on = l.included && !blocked;
            return (
              <span key={l.name} style={{ ...S.lib, ...(on ? null : S.libOff) }}>
                <button
                  type="button"
                  style={{ ...S.libMain, ...(blocked ? S.libBlocked : null) }}
                  aria-pressed={blocked ? undefined : l.included}
                  aria-expanded={blocked ? configFor === l.name : undefined}
                  title={
                    blocked
                      ? `Needs ${l.needs.join(", ") || "configuration"} — click to set it`
                      : l.included
                        ? "Leave this out of the next brief"
                        : "Include it again"
                  }
                  onClick={() =>
                    blocked
                      ? openConfig(l.name)
                      : send({ type: "toggle_participation", name: l.name })
                  }
                >
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
                {/* Every ability that HAS settings shows the cog, configured or
                    not — a pill that silently lacks one reads as a different
                    kind of thing. What differs is only the body: it toggles
                    when the ability can run, and opens the same settings when
                    it cannot. */}
                {l.fields.length > 0 && (
                  <button
                    type="button"
                    className="cmp-icon" style={S.libGear}
                    title={`${l.title} settings`}
                    aria-label={`${l.title} settings`}
                    aria-expanded={configFor === l.name}
                    onClick={() => openConfig(l.name)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3.2" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008 3.6 1.65 1.65 0 009 2.09V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.4 8v0a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        {/* Depth sets how many inquiries run and how long they may work. An ask
            runs exactly one agent to a straight answer, so there is no breadth to
            choose and the minutes would be quoted against a plan that never
            exists. The configured effort still bounds the agent; it is simply not
            a question worth asking here. */}
        {!willSkipPlanner && (
          <div style={S.depths} role="radiogroup" aria-label="Depth">
            {DEPTHS.map((d) => {
              const pace = paceFor(d.depth, shape);
              return (
                <button
                  key={d.depth}
                  type="button"
                  role="radio"
                  aria-checked={d.depth === depth}
                  className="cmp-pill" style={d.depth === depth ? S.depthOn : S.depth}
                  title={pace.observed ? undefined : "estimated — runs on this machine refine it"}
                  onClick={() => send({ type: "set_effort", effort: d.depth })}
                >
                  {d.title} · {estimateLabel(d.depth, tasks, pace)}
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>
      <button type="button" className="cmp-send" style={S.send} onClick={submit} aria-label="Send" disabled={uploading || pending !== null}>
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
  const banked = useBrief(selectBanked);
  const resumedAt = useBrief(selectResumedAt);
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
  stack: { display: "flex", flexDirection: "column", gap: 9, flex: 1, minWidth: 0 },
  /** The question and the two controls that act on it. The row carries its own
   *  height so the field has room to breathe — the card used to be one tight
   *  line of everything. */
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
