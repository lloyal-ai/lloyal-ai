import { useRef, useState } from "react";
import type { Descriptor } from "@lloyal-labs/media";
export type Picked = {
  id: number;
  name: string;
  root?: Descriptor;
  error?: string;
};
type Draft = { text: string; files: Picked[] };
const empty = (): Draft => ({ text: "", files: [] });
function read(): Record<string, Draft> {
  try {
    const saved = JSON.parse(localStorage.getItem("glass.drafts") ?? "{}");
    return Object.fromEntries(
      Object.entries(saved)
        .filter(
          ([, d]: [string, any]) =>
            typeof d?.text === "string" && Array.isArray(d.files),
        )
        .map(([k, d]: [string, any]) => [
          k,
          {
            text: d.text,
            files: d.files.map((f: Picked) =>
              !f.root && !f.error
                ? {
                    ...f,
                    error: "Upload interrupted. Remove and attach again.",
                  }
                : f,
            ),
          },
        ]),
    );
  } catch {
    return {};
  }
}
/** Drafts are browser-local; only a conversation receipt acknowledges a submitted turn. */
export function useConversationDraft(id: string | null) {
  const all = useRef<Record<string, Draft> | null>(null);
  if (all.current === null) all.current = read();
  const [, changed] = useState(0),
    [error, setError] = useState("");
  const key = id ?? "new",
    current = all.current[key] ?? empty();
  function update(target: string, fn: (d: Draft) => Draft) {
    all.current = {
      ...all.current,
      [target]: fn(all.current![target] ?? empty()),
    };
    try {
      localStorage.setItem("glass.drafts", JSON.stringify(all.current));
      setError("");
    } catch {
      setError("This draft could not be saved on this browser.");
    }
    changed((n) => n + 1);
  }
  return {
    key,
    ...current,
    error,
    setText: (text: string) => update(key, (d) => ({ ...d, text })),
    setFiles: (fn: (files: Picked[]) => Picked[]) =>
      update(key, (d) => ({ ...d, files: fn(d.files) })),
    clear: (target: string) => update(target, empty),
  };
}
