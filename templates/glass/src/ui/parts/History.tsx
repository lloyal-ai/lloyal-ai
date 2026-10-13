import { useEffect, useRef, useState } from "react";
import { useProjection, useSend, useVoiceInput } from "@lloyal-labs/ui";
import workletUrl from "@lloyal-labs/ui/pcm-worklet?url&no-inline";
import type { AppState } from "../state.js";
import type { Command } from "../../protocol.js";
import { PreferencesView } from "./Preferences.js";
import { VoiceButton, VoiceCapture } from "./Voice.js";

export function History({ open, close }: { open: boolean; close(): void }) {
  const state = useProjection((s: AppState) => s);
  const send = useSend<Command>();
  const [search, setSearch] = useState("");
  const panel = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput({
    workletUrl,
    draft: search,
    onDraft: setSearch,
    disabled: !open,
    destination: open ? "history" : null,
  });
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  function dismiss() {
    voice.cancel();
    close();
  }
  function navigate(id: string | null) {
    send({ type: "open_conversation", id });
    dismiss();
  }
  useEffect(() => {
    const timeout = setTimeout(
      () => send({ type: "search_conversations", query: search }),
      160,
    );
    return () => clearTimeout(timeout);
  }, [search, send]);
  const items = search
    ? state.search?.query === search
      ? state.search.entries
      : []
    : state.entries;
  return (
    <>
      {open && (
        <button
          type="button"
          className="gc-nav-shade"
          aria-label="Close history"
          onClick={dismiss}
        />
      )}
      <nav
        ref={panel}
        className="gc-rail"
        aria-label="Conversation history"
        inert={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            dismiss();
          }
          if (event.key === "Tab") {
            const items = Array.from(
              panel.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select,summary",
              ) ?? [],
            );
            const first = items[0],
              last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="gc-rail-top">
          <button
            className="gc-icon"
            type="button"
            aria-label="Close history"
            onClick={dismiss}
          >
            ×
          </button>
          <span>History</span>
          <span className="gc-spacer" />
          <button
            className="gc-icon"
            type="button"
            aria-label="New conversation"
            onClick={() => navigate(null)}
          >
            +
          </button>
        </div>
        <div className="gc-search">
          {voice.active ? (
            <VoiceCapture voice={voice} />
          ) : (
            <>
              <input
                ref={searchRef}
                aria-label="Search conversations"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <VoiceButton voice={voice} />
            </>
          )}
        </div>
        {voice.error && (
          <p role="alert" className="gc-history-note">
            {voice.error}
          </p>
        )}
        {voice.pending && (
          <button
            className="gc-small"
            type="button"
            onClick={voice.insertPending}
          >
            Insert transcript
          </button>
        )}
        <div className="gc-nav-label">Conversations</div>
        {items.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className="gc-history-item"
            aria-current={entry.id === state.activeId ? "page" : undefined}
            onClick={() => navigate(entry.id)}
          >
            <span>{entry.title}</span>
          </button>
        ))}
        {!items.length && (
          <p className="gc-history-note">
            {search
              ? "No matching conversations."
              : "Your conversations will appear here."}
          </p>
        )}
        <PreferencesView />
      </nav>
    </>
  );
}
