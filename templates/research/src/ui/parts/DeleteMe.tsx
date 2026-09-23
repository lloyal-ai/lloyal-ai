/**
 * Where this harness came from — the CLI that built it, and the docs.
 *
 * Named for what to do with it: this is ours, not yours. Delete the file, its import and its one tag, and
 * nothing else changes.
 */
import type { ReactElement } from "react";
import { useState } from "react";
import { color } from "../theme.js";

/** GitHub's own octicons, inline so this costs no dependency: the mark, and `book`. */
const MARK =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z";
const BOOK =
  "M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z";

const LINKS = [
  { label: "GitHub", href: "https://github.com/lloyal-ai/lloyal-ai", icon: MARK },
  { label: "Docs", href: "https://docs.lloyal.ai/", icon: BOOK },
];

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: 9, marginBottom: 13 },
  // `dim`, never `faint`: the palette reserves faint for ornament, and a link is a control.
  link: {
    display: "flex", alignItems: "center", gap: 7,
    color: color.dim, textDecoration: "none", fontSize: 12, width: "fit-content",
  },
} as const;

export function DeleteMe(): ReactElement {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div style={S.wrap}>
      {LINKS.map(({ label, href, icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{ ...S.link, color: over === label ? color.ink : color.dim }}
          onMouseEnter={() => setOver(label)}
          onMouseLeave={() => setOver(null)}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d={icon} />
          </svg>
          {label}
        </a>
      ))}
    </div>
  );
}
