/** The question a document was started with, as its title. It is the heading while it reads as one: fewer than
 *  three lines at heading size, at the width it is shown in. Anything longer, a pasted passage, is the reader's own
 *  words at reading size, held to a few lines until asked for whole. Either way its line breaks are the reader's.
 *  Whether it reads as a heading is measured from a copy laid out at heading size out of sight, so choosing the
 *  size never changes what is measured, and it is measured again when the width changes. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { color, font } from "../theme.js";

/** The most lines a question may take at heading size and still be the heading. */
const HEADING_MOST_LINES = 2;
/** The most lines a passage shows until it is asked for whole. */
const PASSAGE_LINES = 8;

/** Whether a question laid out at heading size, `heightPx` tall in lines of `lineHeightPx`, reads as a heading. */
export const readsAsHeading = (heightPx: number, lineHeightPx: number): boolean =>
  Math.round(heightPx / lineHeightPx) <= HEADING_MOST_LINES;

export function QuestionTitle({ question, below }: {
  question: string;
  /** The room beneath it, which each moment sets for what follows. */
  below: number;
}): ReactElement {
  const measure = useRef<HTMLDivElement>(null);
  const passage = useRef<HTMLHeadingElement>(null);
  const [heading, setHeading] = useState(true);
  const [whole, setWhole] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => setWhole(false), [question]);
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    const judge = (): void => setHeading(readsAsHeading(el.offsetHeight, parseFloat(getComputedStyle(el).lineHeight)));
    judge();
    const observer = new ResizeObserver(judge);
    observer.observe(el);
    return () => observer.disconnect();
  }, [question]);
  // "Show all" is offered only when the passage is held short of its whole.
  useLayoutEffect(() => {
    const el = passage.current;
    if (!el || whole) return;
    const check = (): void => setHeld(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [heading, question, whole]);
  return (
    <div style={{ position: "relative", marginBottom: below }}>
      <div ref={measure} aria-hidden="true" inert style={{ ...S.heading, ...S.measure }}>{question}</div>
      {heading ? <h1 style={S.heading}>{question}</h1> : (
        <>
          <h1 ref={passage} style={{ ...S.passage, ...(whole ? null : S.held) }}>{question}</h1>
          {(held || whole) && (
            <button type="button" style={S.toggle} onClick={() => setWhole((w) => !w)}>
              {whole ? "Show less" : "Show all"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  heading: {
    font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: 0,
    whiteSpace: "pre-wrap", overflowWrap: "anywhere", textWrap: "balance",
  },
  /** The heading-size copy the choice is measured from: the column's width, out of sight and out of reach. */
  measure: { position: "absolute", left: 0, right: 0, top: 0, visibility: "hidden", pointerEvents: "none" },
  /** The reader's words, at the size the answer is read at. */
  passage: {
    font: `500 15.5px/1.6 ${font.ui}`, color: color.ink, margin: 0,
    whiteSpace: "pre-wrap", overflowWrap: "anywhere",
    borderLeft: `3px solid ${color.line}`, padding: "1px 0 1px 14px",
  },
  held: { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: PASSAGE_LINES, overflow: "hidden" },
  toggle: {
    font: `600 12px ${font.ui}`, color: color.dim, background: "none", border: 0,
    padding: 0, margin: "8px 0 0 17px", cursor: "pointer",
  },
};
