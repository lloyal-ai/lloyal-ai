/**
 * What this installation keeps for its reader, in `user.json` beside `harness.yml`.
 *
 * `harness.*` is the developer's schema: every key in `harness.json` must be one the app declared in
 * `src/config.ts`, and the config layer owns that file's version, provenance and reset. This file is the
 * opposite — the reader's own content, which the app never declared and cannot layer. It persists, but it
 * is not configuration: "reset to default" would delete what the reader made, and sharing it would share
 * their names.
 *
 * Writes are atomic (a temporary file beside it, then a rename), because a half-written `user.json` is a
 * reader's word list lost. A file this app cannot read starts empty and says so once; it is never
 * overwritten to hide the problem.
 *
 * @module
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation } from 'effection';
import type { LexiconEntry } from '../protocol.js';

/** The one name the file is read and written under. */
export const USER_SETTINGS_FILE = 'user.json';

/** What is kept. One version field, owned here; `harness.json` keeps its own. */
export interface UserSettings {
  version: 1;
  transcription: { entries: LexiconEntry[] };
}

/** A fresh installation's file: nothing said yet. */
export const emptySettings = (): UserSettings => ({ version: 1, transcription: { entries: [] } });

/** The store as the harness uses it: whole document in, whole document out, in the run's own scope. */
export interface SettingsStore {
  read(): Operation<UserSettings>;
  set(settings: UserSettings): Operation<void>;
}

export interface SettingsStoreOptions {
  /** A file this app could not read: said once, then the reader works from an empty list. */
  onProblem?(problem: string): void;
}

/** `user.json` under `root` — the installation's data root, `runner.projectRoot`. */
export function fileSettingsStore(root: string, options: SettingsStoreOptions = {}): SettingsStore {
  const file = join(root, USER_SETTINGS_FILE);
  return {
    *read() {
      if (!existsSync(file)) return emptySettings();
      let raw: string;
      try {
        raw = readFileSync(file, 'utf8');
      } catch {
        options.onProblem?.('unreadable');
        return emptySettings();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        options.onProblem?.('unreadable');
        return emptySettings();
      }
      // A version this app does not know is not corruption: leave it for the app that wrote it.
      if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version !== 1) {
        return emptySettings();
      }
      if (!isSettings(parsed)) {
        options.onProblem?.('unreadable');
        return emptySettings();
      }
      return parsed;
    },
    *set(settings) {
      const partial = `${file}.${process.pid}.partial`;
      writeFileSync(partial, `${JSON.stringify(settings, null, 2)}\n`);
      renameSync(partial, file);
    },
  };
}

function isSettings(value: unknown): value is UserSettings {
  if (typeof value !== 'object' || value === null) return false;
  const transcription = (value as { transcription?: unknown }).transcription;
  if (typeof transcription !== 'object' || transcription === null) return false;
  const entries = (transcription as { entries?: unknown }).entries;
  return Array.isArray(entries) && entries.every(isEntry);
}

function isEntry(value: unknown): value is LexiconEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { term?: unknown; heardAs?: unknown };
  if (typeof entry.term !== 'string' || entry.term.trim() === '') return false;
  if (entry.heardAs === undefined) return true;
  return Array.isArray(entry.heardAs)
    && entry.heardAs.every((heard) => typeof heard === 'string' && heard.trim() !== '');
}
