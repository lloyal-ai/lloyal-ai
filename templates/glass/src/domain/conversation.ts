import { z } from "zod";
import { Answer, Selection } from "./answer.js";
import { Mode, Plan } from "./work.js";
import { Preferences } from "./preferences.js";

export const MediaRef = z.object({
  digest: z.string(),
  mediaType: z.string(),
  size: z.number(),
});
export const Turn = z.object({
  id: z.uuid(),
  question: z.string(),
  continuationOf: z.uuid().optional(),
  directions: z
    .array(
      z.object({ id: z.uuid(), query: z.string(), submittedAt: z.string() }),
    )
    .default([]),
  submittedAt: z.string(),
  status: z.enum(["pending", "complete", "partial", "interrupted", "failed"]),
  answer: z.string().nullable(),
  reason: z.string().optional(),
  payload: Answer.optional(),
  checked: z.array(z.number().int().nonnegative()).optional(),
  mode: Mode.optional(),
  plan: Plan.optional(),
  selection: Selection.optional(),
  preferences: Preferences.optional(),
  sourceScope: z
    .object({
      inputs: z.array(z.string()),
      excluded: z.array(z.string()),
      roots: z.array(MediaRef).optional(),
    })
    .optional(),
  viewed: z.array(MediaRef).default([]),
  excluded: z.array(z.string()).default([]),
  attachments: z.array(MediaRef).default([]),
});
export type Turn = z.infer<typeof Turn>;
export const Conversation = z.object({
  version: z.literal(1),
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  title: z.string(),
  updatedAt: z.string(),
  turns: z.array(Turn),
});
export type Conversation = z.infer<typeof Conversation>;
export type ConversationEntry = Pick<
  Conversation,
  "id" | "revision" | "title" | "updatedAt"
>;
export const entryOf = ({
  id,
  revision,
  title,
  updatedAt,
}: Conversation): ConversationEntry => ({ id, revision, title, updatedAt });

// A restriction retains the selected descriptors even when their original upload
// belongs to an earlier turn outside the inference boundary.
export function inferenceTurns(record: Conversation): Turn[] {
  const boundary = record.turns.map((t) => !!t.sourceScope).lastIndexOf(true);
  return boundary < 0 ? record.turns : record.turns.slice(boundary);
}
export function inferenceRoots(turn: Turn): z.infer<typeof MediaRef>[] {
  return turn.sourceScope
    ? (turn.sourceScope.roots ?? turn.attachments).filter((a) =>
        turn.sourceScope!.inputs.includes(a.digest),
      )
    : turn.attachments;
}
