/** The question, as a passage rather than a line: the field grows with what is written, to most of a passage, then
 *  scrolls inside itself, so a pasted passage can be read before it is sent. Enter sends; Shift+Enter breaks
 *  the line. One line of it is the height the question row has always had, so an empty composer is the size it
 *  was. The look (font, ink) is the caller's; the line metrics are the field's, since its cap is counted in
 *  them. */
import { useLayoutEffect, type ComponentProps, type CSSProperties, type ReactElement, type RefObject } from "react";

/** How many lines show before the field scrolls, so a pasted passage can mostly be read in place; and the most of
 *  the window it may take, so a short window still shows the brief above it. */
const MOST_LINES = 18;
const MOST_OF_WINDOW = "40vh";
const LINE_PX = 22;
/** Above and below the text: one line and this, twice, is the question row's height. */
const PAD_PX = 8;

/** Whether a key sends the question: Enter, unless Shift asks for a new line or an input method is composing
 *  (its Enter chooses the characters). */
export const sends = (e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean =>
  e.key === "Enter" && !e.shiftKey && !e.isComposing;

/** As tall as its text, which `maxHeight` caps; past the cap the field scrolls. */
const fit = (el: HTMLTextAreaElement): void => {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

export function QuestionField({ ref, value, onSend, style, ...field }: Omit<ComponentProps<"textarea">, "ref" | "rows" | "onKeyDown"> & {
  /** The caller's handle on the field: dictation reads its cursor from it, and it takes focus through it. */
  ref: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onSend: () => void;
}): ReactElement {
  useLayoutEffect(() => { if (ref.current) fit(ref.current); }, [ref, value]);
  // A narrower composer wraps the same words onto more lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return (
    <textarea
      {...field}
      ref={ref}
      rows={1}
      value={value}
      onKeyDown={(e) => {
        if (!sends({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) return;
        e.preventDefault();
        onSend();
      }}
      style={{ ...style, ...METRICS }}
    />
  );
}

const METRICS: CSSProperties = {
  display: "block", boxSizing: "border-box", margin: 0, border: 0, outline: 0, background: "none", resize: "none",
  lineHeight: `${LINE_PX}px`, padding: `${PAD_PX}px 0`, overflowY: "auto",
  maxHeight: `min(${MOST_LINES * LINE_PX + 2 * PAD_PX}px, ${MOST_OF_WINDOW})`,
};
