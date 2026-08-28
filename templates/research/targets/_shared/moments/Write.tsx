/** Moment 03 — Watch it write. Sections fill in place beneath the title;
 *  each live section carries its inquiry's activity. (This thin cut renders
 *  the sections and streaming prose; inquiry verbs, steering, and the run
 *  controls arrive with the write build-out.) */
import type { CSSProperties, ReactElement } from "react";
import { color, font } from "../theme.js";
import { useBrief } from "../store.js";
import { selectAnswer, selectTitle } from "../select.js";
import { Thinking, doc } from "../parts/Shell.js";
import { Prose } from "../parts/Prose.js";

export function Write(): ReactElement {
  const title = useBrief(selectTitle);
  const answer = useBrief(selectAnswer);

  return (
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>
      {answer?.body ? (
        <>
          <Prose markdown={answer.body} />
          {answer.streaming && <span className="fn-caret" />}
        </>
      ) : (
        <p style={S.beat}><Thinking>writing…</Thinking></p>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 6px", textWrap: "balance" },
  beat: { font: `14px ${font.ui}`, color: color.dim, margin: "16px 0 0" },
};
