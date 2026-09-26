/**
 * The settled prose sheds the bare source list the weave and the synth end
 * with — and does so in time linear in the body. The regex that did this
 * before backtracked catastrophically on a body whose reference list was
 * followed by more text (the settled report's annexure index), which pinned
 * a browser tab at 100% CPU on every open of such a brief.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shedTrailingSources } from "../../src/ui/select.js";

const PROSE = "# Findings\n\nContinuous batching admits requests per iteration [1](https://a.io/1).\n";

test("a trailing source list, under its heading, is shed; the prose keeps everything above it", () => {
  const body = `${PROSE}\nSources:\n- [A](https://a.io/1) — the survey\n- [B](https://b.io) see also\n\n`;
  assert.equal(shedTrailingSources(body), PROSE.trimEnd());
  const headed = `${PROSE}\n## References\n\n1. [A](https://a.io/1)\n2. [B](https://b.io)\n`;
  assert.equal(shedTrailingSources(headed), PROSE.trimEnd());
});

test("a list followed by more prose, or under another heading, is left alone", () => {
  const followed = `${PROSE}\nSources:\n- [A](https://a.io/1)\n\nAnd one more thought.\n`;
  assert.equal(shedTrailingSources(followed), followed.trimEnd());
  const annexures = `${PROSE}\n---\n\n## Annexures\n\n- [Annexure 1](./annexure-1.md) — the first inquiry\n- [Annexure 2](./annexure-2.md) — the second\n`;
  assert.equal(shedTrailingSources(annexures), annexures.trimEnd());
});

test("a settled report's shape — a long reference list, then the annexure index — is shed or kept in bounded time", () => {
  const refs = Array.from({ length: 40 }, (_, i) => `[${i + 1}](https://a.io/${i}) Title ${i} — see [x](https://b.io/${i}) and [y](https://c.io/${i}) too  `).join("\n");
  const body = `${PROSE}\n## Key References\n\n${refs}\n\n---\n\n## Annexures\n\n- [Annexure 1](./annexure-1.md) — one\n- [Annexure 2](./annexure-2.md) — two\n`;
  const t0 = performance.now();
  const out = shedTrailingSources(body);
  const ms = performance.now() - t0;
  assert.equal(out, body.trimEnd(), "the annexure index is not a source list; nothing is shed");
  assert.ok(ms < 200, `linear: took ${Math.round(ms)} ms`);
});
