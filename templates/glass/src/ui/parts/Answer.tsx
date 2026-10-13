import { useEffect, useRef, useState } from "react";
import { useSend } from "@lloyal-labs/ui";
import type { Command } from "../../protocol.js";
import type { Turn } from "../../domain/conversation.js";
import type { Selection } from "../../domain/answer.js";
import { proseText } from "../../domain/prose.js";
import { Prose, StreamingProse } from "./Prose.js";
export function AnswerView({
  recordId,
  revision,
  mutable,
  turn,
  digests,
  stream,
  onSelect,
  selected: reference,
}: {
  recordId: string;
  revision: number;
  mutable: boolean;
  turn: Turn;
  digests: string[];
  stream: string;
  selected?: Selection | null;
  onSelect(s: Selection): void;
}) {
  const send = useSend<Command>(),
    prose = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const a = turn.payload,
    body = a?.result ?? turn.answer ?? stream;
  useEffect(() => {
    const name = "glass-selection-" + turn.id;
    if (
      !prose.current ||
      !reference ||
      reference.unit !== "prose-text" ||
      reference.start === undefined ||
      reference.end === undefined ||
      !CSS.highlights
    )
      return;
    const walker = document.createTreeWalker(
      prose.current,
      NodeFilter.SHOW_TEXT,
    );
    let offset = 0,
      node: Node | null,
      start: Node | null = null,
      end: Node | null = null,
      from = 0,
      to = 0;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      if (start === null && reference.start < offset + length) {
        start = node;
        from = reference.start - offset;
      }
      if (reference.end <= offset + length) {
        end = node;
        to = reference.end - offset;
        break;
      }
      offset += length;
    }
    if (start && end) {
      const range = document.createRange();
      range.setStart(start, from);
      range.setEnd(end, to);
      if (range.toString() === reference.text)
        CSS.highlights.set(name, new Highlight(range));
    }
    return () => {
      CSS.highlights.delete(name);
    };
  }, [reference, body, turn.id]);
  if (!body && !a) return null;
  function selected(text: string, unit: string, start?: number, end?: number) {
    if (text.length > 64000) {
      setNotice("Select a smaller passage.");
      return;
    }
    onSelect({
      turnId: turn.id,
      answerRevision: 1,
      unit,
      text,
      ...(start !== undefined ? { start, end } : {}),
    });
  }
  const choose = () => {
    if (!turn.answer || !prose.current) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0),
      text = range.toString();
    if (!text.trim()) return;
    if (
      !prose.current.contains(range.startContainer) ||
      !prose.current.contains(range.endContainer)
    )
      return;
    // Count preceding rendered occurrences to disambiguate repeated plain text.
    // Structured table/checklist units have their own identities below.
    const before = range.cloneRange();
    before.selectNodeContents(prose.current);
    before.setEnd(range.startContainer, range.startOffset);
    const occurrence = before.toString().split(text).length - 1;
    const canonical = proseText(turn.payload?.result ?? turn.answer);
    let start = -1;
    for (let i = 0; i <= occurrence; i++) {
      start = canonical.indexOf(text, start + 1);
      if (start < 0) {
        setNotice(
          "Select the text within one passage, or use Ask about this answer.",
        );
        return;
      }
    }
    selected(text, "prose-text", start, start + text.length);
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(turn.answer!);
      setNotice("Copied");
    } catch {
      setNotice(
        "Copy was unavailable. You can select the answer text directly.",
      );
    }
  }
  return (
    <article
      className="gc-answer"
      data-selected={reference?.unit === "prose"}
      aria-label="Answer"
    >
      <style>{`::highlight(glass-selection-${turn.id}) { background: #4d80ff38; color: #f2f5ff; }`}</style>
      {turn.plan && <div className="gc-status">Combined answer</div>}
      <div
        ref={prose}
        onDragStart={(e) => {
          if (reference?.turnId === turn.id)
            e.dataTransfer.setData(
              "application/x-glass-reference",
              JSON.stringify(reference),
            );
        }}
        onMouseUp={choose}
        onTouchEnd={choose}
        onKeyUp={(e) => {
          if (e.key === "Shift") choose();
        }}
      >
        <StreamingProse markdown={body} digests={digests} />
      </div>
      {a?.table && (
        <div className="glass-table-scroll">
          <table>
            <thead>
              <tr>
                {a.table.columns.map((c, i) => (
                  <th key={i} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <button
                        className="glass-cell"
                        data-selected={reference?.unit === `cell:${i}:${j}`}
                        title="Ask about this cell"
                        onClick={() => selected(cell, `cell:${i}:${j}`)}
                      >
                        <Prose markdown={cell} digests={digests} />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a?.checklist && (
        <ul className="gc-checklist">
          {a.checklist.map((item, i) => (
            <li key={i} data-selected={reference?.unit === "check:" + i}>
              <label>
                <input
                  type="checkbox"
                  disabled={!mutable}
                  checked={turn.checked?.includes(i) ?? false}
                  onChange={(e) =>
                    send({
                      type: "check_item",
                      id: recordId,
                      turnId: turn.id,
                      revision,
                      index: i,
                      checked: e.target.checked,
                    })
                  }
                />
                <span>
                  <Prose markdown={item.text} digests={digests} />
                  <small>
                    <Prose markdown={item.detail} digests={digests} />
                  </small>
                </span>
              </label>
              <button
                className="gc-small"
                aria-label={"Ask about " + item.text}
                onClick={() => selected(item.text, "check:" + i)}
              >
                Ask
              </button>
            </li>
          ))}
        </ul>
      )}
      {turn.answer && (
        <div className="gc-answer-actions">
          <button
            className="gc-small"
            onClick={() => {
              void copy();
            }}
          >
            Copy
          </button>
          <button
            className="gc-small"
            onClick={() =>
              selected(turn.answer!, "prose", 0, turn.answer!.length)
            }
          >
            Ask about this answer
          </button>
          {turn.plan && (
            <details>
              <summary>Saved approach</summary>
              <ol>
                {turn.plan.tasks.map((t) => (
                  <li key={t.id}>
                    <button
                      className="glass-cell"
                      data-selected={reference?.unit === "step:" + t.id}
                      onClick={() => selected(t.instruction, "step:" + t.id)}
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
      {notice && (
        <p className="gc-status" role="status">
          {notice}
        </p>
      )}
    </article>
  );
}
