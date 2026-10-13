import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Conversation, entryOf } from "../domain/conversation.js";
import type { ConversationEntry } from "../domain/conversation.js";

// All sessions in one host share this ownership table. The disk record is the
// durable truth; this table distinguishes live pending turns from interrupted ones.
const live = new Set<string>();
const keyOf = (root: string, id: string) => `${root}/${id}`;
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class Conversations {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }
  private path(id: string): string {
    if (!validId(id)) throw new Error("Invalid conversation identity.");
    return join(this.root, `${id}.json`);
  }
  read(id: string): Conversation {
    const record = Conversation.parse(
      JSON.parse(readFileSync(this.path(id), "utf8")),
    );
    if (record.id !== id)
      throw new Error("Conversation identity does not match its record.");
    if (live.has(keyOf(this.root, id))) return record;
    return {
      ...record,
      turns: record.turns.map((t) =>
        t.status === "pending"
          ? {
              ...t,
              status: "interrupted" as const,
              reason: "The session ended before an answer was saved.",
            }
          : t,
      ),
    };
  }
  list(): { entries: ConversationEntry[]; errors: string[] } {
    const entries: ConversationEntry[] = [],
      errors: string[] = [];
    for (const file of readdirSync(this.root).filter((f) =>
      f.endsWith(".json"),
    )) {
      try {
        entries.push(entryOf(this.read(file.slice(0, -5))));
      } catch {
        errors.push(
          `Could not read saved conversation ${file}. It has been left intact.`,
        );
      }
    }
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { entries, errors };
  }
  create(): Conversation {
    return {
      version: 1,
      id: randomUUID(),
      revision: 0,
      title: "New conversation",
      updatedAt: new Date().toISOString(),
      turns: [],
    };
  }
  isLive(id: string): boolean {
    return live.has(keyOf(this.root, id));
  }
  claim(id: string): () => void {
    if (this.isLive(id))
      throw new Error(
        "This conversation is already working in another session.",
      );
    const key = keyOf(this.root, id);
    live.add(key);
    return () => live.delete(key);
  }
  save(record: Conversation, expectedRevision: number): Conversation {
    const path = this.path(record.id);
    const current = existsSync(path)
      ? Conversation.parse(JSON.parse(readFileSync(path, "utf8")))
      : null;
    if ((current?.revision ?? 0) !== expectedRevision)
      throw new Error(
        "This conversation changed. Reopen it before sending again.",
      );
    const next = Conversation.parse({
      ...record,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    });
    const temp = `${path}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temp, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(next) + "\n");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, path);
      const directory = openSync(this.root, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temp)) unlinkSync(temp);
    }
    return next;
  }
  remove(id: string, revision: number): void {
    if (this.isLive(id))
      throw new Error("Stop this conversation before discarding it.");
    if (this.read(id).revision !== revision)
      throw new Error(
        "This conversation changed. Reopen it before discarding.",
      );
    unlinkSync(this.path(id));
    const directory = openSync(this.root, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}
