/** The reader's own settings, over the app: one modal, groups down its left, the chosen group's work to the
 *  right. Transcription is first because it is the one thing here today; the rail takes more groups without
 *  changing the shape.
 *
 * Mounted only while it is open, so the browser's own modal (`showModal`) owns the focus trap, the backdrop and
 * Escape, and the control that opened it has its focus back on the way out. Nothing here is stored: the words
 * are a projection of the session's lexicon, and every edit is a command the host answers with the whole list. */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useProjection, useSend } from "@lloyal-labs/ui";
import type { Command } from "../../protocol.js";
import { selectLexicon } from "../select.js";
import { color, font, radius, shadow } from "../theme.js";

/** What the reader came to change. One today; a group is a row here and a section to the right. */
type Group = "transcription";

const GROUPS: readonly { id: Group; title: string }[] = [
  { id: "transcription", title: "Transcription" },
];

export function SettingsDialog({ onClose }: { onClose(): void }): ReactElement {
  const send = useSend<Command>();
  const entries = useProjection(selectLexicon);
  const [group, setGroup] = useState<Group>("transcription");
  const [term, setTerm] = useState("");
  const [heard, setHeard] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); opener?.focus(); };
  }, []);

  const add = (): void => {
    const clean = term.trim();
    if (!clean) return;
    const heardAs = heard.split(",").map((word) => word.trim()).filter(Boolean);
    send({ type: "add_lexicon_term", term: clean, ...(heardAs.length > 0 ? { heardAs } : {}) });
    setTerm("");
    setHeard("");
  };

  return (
    <dialog
      ref={dialog}
      className="fn-settings"
      aria-label="Settings"
      style={S.dialog}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <style>{`dialog.fn-settings::backdrop{background:rgba(20,20,30,.28);}`}</style>
      <div style={S.panel}>
        <nav style={S.groups} aria-label="Settings groups">
          {GROUPS.map((item) => (
            <button
              key={item.id} type="button"
              style={{ ...S.group, ...(item.id === group ? S.groupOn : null) }}
              aria-current={item.id === group ? "page" : undefined}
              onClick={() => setGroup(item.id)}
            >
              {item.title}
            </button>
          ))}
        </nav>

        <section style={S.body} aria-label="Transcription settings">
          <header style={S.head}>
            <h2 style={S.title}>Transcription</h2>
            <button type="button" style={S.close} onClick={onClose} title="Close settings" aria-label="Close settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <p style={S.lede}>
            Words your speech recognition should get right. They are suggested to the model, then put right in
            the text.
          </p>

          {entries.length === 0 ? (
            <p style={S.empty}>Nothing yet. Add a name, a product, or a piece of jargon.</p>
          ) : (
            <ul style={S.list}>
              {entries.map((entry) => (
                <li key={entry.term} style={S.row}>
                  <span style={S.word}>
                    <span style={S.term}>{entry.term}</span>
                    {entry.heardAs !== undefined && entry.heardAs.length > 0 && (
                      <span style={S.heard}>also heard as {entry.heardAs.join(", ")}</span>
                    )}
                  </span>
                  <button
                    type="button" style={S.remove}
                    title={`Remove ${entry.term}`} aria-label={`Remove ${entry.term}`}
                    onClick={() => send({ type: "remove_lexicon_term", term: entry.term })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form style={S.add} onSubmit={(event) => { event.preventDefault(); add(); }}>
            <input
              style={S.input} value={term} placeholder="Word or name" aria-label="Word or name"
              onChange={(event) => setTerm(event.target.value)}
            />
            <input
              style={S.input} value={heard} placeholder="Also heard as (comma separated)" aria-label="Also heard as"
              onChange={(event) => setHeard(event.target.value)}
            />
            <button type="submit" style={S.submit} disabled={term.trim() === ""}>Add</button>
          </form>
        </section>
      </div>
    </dialog>
  );
}

const S: Record<string, CSSProperties> = {
  dialog: {
    margin: "auto", padding: 0, border: 0, borderRadius: radius.panel,
    background: color.card, color: color.ink, font: `13.5px/1.5 ${font.ui}`,
    boxShadow: shadow.raised, width: "min(720px, calc(100vw - 48px))", maxHeight: "min(640px, calc(100vh - 48px))",
    overflow: "hidden",
  },
  panel: { display: "flex", minHeight: 360, maxHeight: "inherit" },
  groups: {
    width: 180, flex: "none", padding: "16px 10px", borderRight: `1px solid ${color.line}`,
    background: color.panel, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto",
  },
  group: {
    textAlign: "left", background: "none", border: 0, borderRadius: radius.control,
    padding: "7px 10px", cursor: "pointer", color: color.dim, font: `500 13px ${font.ui}`,
  },
  groupOn: { background: color.card, color: color.ink, boxShadow: shadow.card },
  body: { flex: 1, minWidth: 0, padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" },
  head: { display: "flex", alignItems: "center", gap: 10 },
  title: { margin: 0, font: `600 15px ${font.ui}` },
  close: {
    marginLeft: "auto", background: "none", border: 0, padding: 4, borderRadius: 7,
    cursor: "pointer", color: color.dim, display: "inline-flex",
  },
  lede: { margin: 0, color: color.dim, fontSize: 12.5 },
  empty: { margin: 0, color: color.dim, fontSize: 12.5, fontStyle: "italic" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 },
  row: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "8px 10px", borderRadius: radius.control, background: color.card2,
  },
  word: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  term: { font: `600 13px ${font.ui}` },
  heard: { color: color.dim, fontSize: 12 },
  remove: {
    marginLeft: "auto", background: "none", border: `1px solid ${color.line}`, borderRadius: radius.control,
    padding: "3px 9px", cursor: "pointer", color: color.dim, fontSize: 12,
  },
  add: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto", paddingTop: 6 },
  input: {
    flex: "1 1 140px", minWidth: 0, padding: "7px 9px", borderRadius: radius.control,
    border: `1px solid ${color.line}`, background: color.card, color: color.ink, font: `13px ${font.ui}`,
  },
  submit: {
    padding: "7px 16px", borderRadius: radius.control, border: 0, cursor: "pointer",
    background: color.ink, color: color.card, font: `500 13px ${font.ui}`,
  },
};
