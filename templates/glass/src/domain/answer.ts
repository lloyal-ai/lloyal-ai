import { z } from "zod";
export const Source = z.object({ title: z.string(), url: z.string() });
export const Table = z.object({
  columns: z.array(z.string()).min(1).max(8),
  rows: z.array(z.array(z.string())).max(60),
});
export const Checklist = z
  .array(z.object({ text: z.string(), detail: z.string() }))
  .max(40);
export const Answer = z.object({
  kind: z.enum(["prose", "table", "checklist"]),
  result: z.string(),
  sources: z.array(Source),
  table: Table.optional(),
  checklist: Checklist.optional(),
});
export type Answer = z.infer<typeof Answer>;
export const Selection = z.object({
  turnId: z.uuid(),
  answerRevision: z.literal(1),
  unit: z.string(),
  text: z.string().min(1).max(64000),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional(),
});
export type Selection = z.infer<typeof Selection>;
export function answerText(a: Answer): string {
  const table = a.table
    ? [
        "| " + a.table.columns.join(" | ") + " |",
        "| " + a.table.columns.map(() => "---").join(" | ") + " |",
        ...a.table.rows.map((row) => "| " + row.join(" | ") + " |"),
      ].join("\n")
    : "";
  const checklist =
    a.checklist
      ?.map((item) => `- ${item.text}${item.detail ? ": " + item.detail : ""}`)
      .join("\n") ?? "";
  return [a.result, table, checklist].filter(Boolean).join("\n\n");
}
