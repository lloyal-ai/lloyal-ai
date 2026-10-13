import { useEffect, useRef, useState } from "react";
import {
  useContentOrigin,
  useProjection,
  useSend,
  useVoiceInput,
} from "@lloyal-labs/ui";
import workletUrl from "@lloyal-labs/ui/pcm-worklet?url&no-inline";
import { ingestMedia } from "@lloyal-labs/media";
import type { Descriptor } from "@lloyal-labs/media";
import type { AppState } from "../state.js";
import type { Command } from "../../protocol.js";
import { activeConversation, isWorking } from "../select.js";
import { VoiceButton, VoiceCapture } from "./Voice.js";
import { Reflection } from "./Reflection.js";
import { Selection } from "../../domain/answer.js";
import { Mode } from "../../domain/work.js";
import { usePreferences } from "../preferences.js";
import { Modes } from "./Modes.js";
import { Abilities } from "./Abilities.js";
import { useConversationDraft } from "../drafts.js";
export function Composer({
  selection,
  onClear,
  onSelect,
}: {
  selection: Selection | null;
  onClear(): void;
  onSelect(value: Selection): void;
}) {
  const { value: preferences } = usePreferences();
  const state = useProjection((s: AppState) => s),
    send = useSend<Command>(),
    origin = useContentOrigin();
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return Mode.parse(localStorage.getItem("glass.mode") ?? "Auto");
    } catch {
      return "Auto";
    }
  });
  function chooseMode(mode: Mode) {
    setMode(mode);
    try {
      localStorage.setItem("glass.mode", mode);
    } catch {}
  }
  const record = activeConversation(state),
    busy = isWorking(state);
  const steerable =
    !selection &&
    busy &&
    state.work?.conversationId === state.activeId &&
    !["stopping", "restoring", "revising"].includes(state.work.phase);
  const local = useConversationDraft(state.activeId),
    draft = local.text,
    setDraft = local.setText,
    files = local.files,
    setFiles = local.setFiles;
  const [submitted, setSubmitted] = useState<string | null>(null),
    [excluded, setExcluded] = useState<string[]>([]);
  const submittedKey = useRef("new"),
    knownReceipts = useRef(new Set<string>());
  useEffect(() => {
    setExcluded(record?.turns.at(-1)?.excluded ?? []);
  }, [state.activeId, record?.turns.at(-1)?.sourceScope]);
  const [drag, setDrag] = useState(false);
  const next = useRef(Date.now()),
    picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState({ key: 0, right: false, bottom: false });
  const uploading = files.some((f) => !f.root && !f.error);
  const voice = useVoiceInput({
    workletUrl,
    draft,
    onDraft: setDraft,
    destination: state.activeId,
    disabled: !state.ready || submitted !== null || uploading,
    selection: () => ({
      start: input.current?.selectionStart ?? draft.length,
      end: input.current?.selectionEnd ?? draft.length,
    }),
  });
  useEffect(() => {
    const receipt =
      submittedKey.current === "new"
        ? Object.values(state.conversations).find((r) =>
            r.turns.some(
              (t) =>
                !knownReceipts.current.has(t.id) && t.question === submitted,
            ),
          )
        : state.conversations[submittedKey.current];
    if (
      submitted !== null &&
      (receipt?.turns.some(
        (t) => !knownReceipts.current.has(t.id) && t.question === submitted,
      ) ||
        receipt?.turns.some((t) =>
          t.directions.some(
            (d) => !knownReceipts.current.has(d.id) && d.query === submitted,
          ),
        ))
    ) {
      local.clear(submittedKey.current);
      setSubmitted(null);
      onClear();
    }
  }, [state.conversations, submitted]);
  useEffect(() => {
    if (state.error) setSubmitted(null);
  }, [state.error]);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height =
        Math.min(input.current.scrollHeight, 140) + "px";
    }
  }, [draft]);
  useEffect(() => {
    if (!voice.active) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") voice.cancel();
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [voice.active, voice.cancel]);
  function attach(chosen: File[]) {
    if (busy) return;
    for (const file of chosen) {
      const id = next.current++;
      setFiles((fs) => [...fs, { id, name: file.name }]);
      void (async () => {
        try {
          if (origin === null)
            throw new Error("Attachment service is unavailable.");
          const root = await ingestMedia(
            origin,
            new Uint8Array(await file.arrayBuffer()),
          );
          setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, root } : f)));
        } catch (error) {
          setFiles((fs) =>
            fs.map((f) =>
              f.id === id
                ? {
                    ...f,
                    error:
                      error instanceof Error ? error.message : "Upload failed.",
                  }
                : f,
            ),
          );
        }
      })();
    }
  }
  function submit() {
    if (
      !draft.trim() ||
      (busy && !steerable) ||
      !state.ready ||
      submitted !== null ||
      voice.active ||
      uploading
    )
      return;
    knownReceipts.current = new Set(
      Object.values(state.conversations).flatMap((r) =>
        r.turns.flatMap((t) => [t.id, ...t.directions.map((d) => d.id)]),
      ),
    );
    submittedKey.current = local.key;
    setSubmitted(draft.trim());
    if (steerable) {
      send({
        type: "steer_work",
        turnId: state.work!.turnId,
        revision: record!.revision,
        query: draft.trim(),
      });
    } else
      send({
        type: "submit_query",
        query: draft.trim(),
        conversationId: state.activeId,
        revision: record?.revision,
        attachments: files.flatMap((f) => (f.root ? [f.root] : [])),
        excluded,
        mode,
        selection: selection ?? undefined,
        preferences,
      });
    setFlash((f) => ({ key: f.key + 1, right: true, bottom: true }));
  }
  return (
    <div className={record ? "gc-dock" : ""}>
      <div
        className="gc-composer gc-surface"
        data-drag={drag}
        ref={surface}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes("Files") ||
            e.dataTransfer.types.includes("application/x-glass-reference")
          ) {
            e.preventDefault();
            setDrag(true);
          }
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const ref = e.dataTransfer.getData("application/x-glass-reference");
          if (ref) {
            try {
              onSelect(Selection.parse(JSON.parse(ref)));
              input.current?.focus();
            } catch {}
          } else attach(Array.from(e.dataTransfer.files));
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setFlash((f) => ({
            key: f.key + 1,
            right: e.clientX > r.left + r.width / 2,
            bottom: e.clientY > r.top + r.height / 2,
          }));
        }}
      >
        <Reflection surface={surface} flash={flash} />
        {busy && selection && (
          <p className="gc-status">
            Finish or stop the current work before asking about this saved
            selection.
          </p>
        )}
        {selection && (
          <div className="gc-selection-chip">
            <span>{selection.text.slice(0, 130)}</span>
            <button
              type="button"
              aria-label="Remove selected reference"
              onClick={onClear}
            >
              ×
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="gc-attachments">
            {files.map((f) => (
              <span key={f.id} className="gc-file">
                <span>
                  {f.name}
                  {!f.root && !f.error ? " · uploading" : ""}
                </span>
                {f.error && <span role="alert">{f.error}</span>}
                <button
                  type="button"
                  aria-label={"Remove " + f.name}
                  onClick={() =>
                    setFiles((fs) => fs.filter((x) => x.id !== f.id))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {voice.active ? (
          <VoiceCapture voice={voice} />
        ) : (
          <textarea
            ref={input}
            autoFocus
            className="gc-input"
            aria-label="Message"
            placeholder={
              record
                ? "Stay with this, or take it somewhere else…"
                : "Ask, talk, or drop something here…"
            }
            rows={1}
            value={draft}
            disabled={submitted !== null}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                attach(files);
              }
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
        <div className="gc-toolbar">
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => {
              attach(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="gc-icon"
            aria-label="Attach files"
            disabled={submitted !== null || busy}
            onClick={() => picker.current?.click()}
          >
            +
          </button>
          <Modes value={mode} onChange={chooseMode} />
          <Abilities excluded={excluded} onExcluded={setExcluded} />
          <span className="gc-spacer" />
          <VoiceButton voice={voice} />
          <button
            type="button"
            className="gc-icon gc-send"
            aria-label="Send message"
            disabled={
              !state.ready ||
              (busy && !steerable) ||
              !draft.trim() ||
              submitted !== null ||
              voice.active ||
              uploading
            }
            onClick={submit}
          >
            ↑
          </button>
        </div>
        {local.error && (
          <p role="alert" className="gc-status">
            {local.error}
          </p>
        )}
        {voice.error && (
          <p role="alert" className="gc-status">
            {voice.error}
          </p>
        )}
        {voice.pending && (
          <button
            type="button"
            className="gc-small"
            onClick={voice.insertPending}
          >
            Insert transcript
          </button>
        )}
      </div>
      {!record && (
        <div className="gc-suggestions">
          {[
            "Explain something",
            "Compare a few options",
            "Talk it through",
          ].map((text) => (
            <button
              type="button"
              key={text}
              onClick={() => {
                setDraft(text + " ");
                input.current?.focus();
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="gc-footer">
        {submitted ? "Saving your message…" : !state.ready ? "Connecting…" : ""}
      </div>
    </div>
  );
}
