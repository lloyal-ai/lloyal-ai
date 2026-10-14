import { z } from "zod";
import { parseAttachmentHref } from "@lloyal-labs/media";
import { defineOutput, weaveSourcesIntoResult } from "@lloyal-labs/rig";
import { stripDanglingToolCall } from "@lloyal-labs/lloyal-agents";
import { Source, Table, Checklist, type Answer } from "../domain/answer.js";
import { withoutSourceTrailer } from "../domain/citations.js";
import { withoutRepeatedTable } from "../domain/table-prose.js";
import { render } from "./prompts.js";
function tableOutput() {
  return Table.refine(
    (table) => table.rows.every((row) => row.length === table.columns.length),
    render("table-shape"),
  ).describe(render("table-shape"));
}
function resultOutput(kind: string) {
  return z
    .string()
    .refine((text) => {
      // Refuse malformed document citation links; resolution/weaving remains framework-owned.
      return [...text.matchAll(/\]\((attachment:\/\/[^)]*)\)/g)].every((m) => {
        const page = parseAttachmentHref(m[1]);
        return page !== null && page.page > 0;
      });
    }, render("source-url"))
    .describe(render("answer-result", { kind }));
}
function sourceOutput() {
  return z
    .array(
      Source.extend({
        url: z
          .string()
          .refine((url) => {
            const page = parseAttachmentHref(url);
            if (page) return page.page > 0;
            try {
              const parsed = new URL(url);
              return /^https?:$/.test(parsed.protocol) && !/\s/.test(url);
            } catch {
              return false;
            }
          }, render("source-url"))
          .describe(render("source-url")),
      }),
    )
    .describe(render("answer-sources"));
}
/** Direct uses one agent and lets its terminal result choose the useful presentation. */
export function flexibleAnswerOutput() {
  const schema = z.object({
    kind: z.enum(["prose", "table", "checklist"]).default("prose"),
    result: resultOutput("auto"),
    sources: sourceOutput(),
    table: tableOutput().optional(),
    checklist: Checklist.optional(),
  });
  return defineOutput("report", schema, {
    description: render("answer-output"),
    grammarOrder: "sampleFirst",
  });
}
export function answerOutput(kind: Answer["kind"]) {
  const common = z.object({
    result: resultOutput(kind),
    sources: sourceOutput(),
  });
  const schema =
    kind === "table"
      ? common.extend({ table: tableOutput() })
      : kind === "checklist"
        ? common.extend({ checklist: Checklist })
        : common;
  return defineOutput("report", schema, {
    description: render("answer-output"),
    grammarOrder: "sampleFirst",
  });
}
/** One acceptance boundary owns the citation weave; later persistence and rendering do not repeat it. */
export function finishAnswer(
  kind: Answer["kind"],
  value: {
    result: string;
    sources: z.infer<typeof Source>[];
    table?: z.infer<typeof Table>;
    checklist?: z.infer<typeof Checklist>;
  },
): Answer {
  if (
    value.table &&
    value.table.rows.some((row) => row.length !== value.table!.columns.length)
  )
    throw new Error("The returned table has inconsistent columns.");
  if (kind === "table" && !value.table)
    throw new Error("No comparison table was returned.");
  if (kind === "checklist" && !value.checklist?.length)
    throw new Error("No checklist was returned.");
  const table = value.table
    ? {
        ...value.table,
        rows: value.table.rows.map((row) =>
          row.map((cell) =>
            withoutSourceTrailer(
              weaveSourcesIntoResult(cell, value.sources),
              value.sources,
            ),
          ),
        ),
      }
    : undefined;
  const checklist = value.checklist?.map((item) => ({
    ...item,
    text: withoutSourceTrailer(
      weaveSourcesIntoResult(item.text, value.sources),
      value.sources,
    ),
    detail: withoutSourceTrailer(
      weaveSourcesIntoResult(item.detail, value.sources),
      value.sources,
    ),
  }));
  return {
    ...value,
    ...(table ? { table } : {}),
    ...(checklist ? { checklist } : {}),
    kind,
    result: weaveSourcesIntoResult(
      withoutRepeatedTable(
        stripDanglingToolCall(value.result, []),
        value.table,
      ),
      value.sources,
    ),
  };
}
