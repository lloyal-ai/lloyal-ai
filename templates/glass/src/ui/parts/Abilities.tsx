import { ComposerPopover } from "./ComposerPopover.js";
import { Chevron } from "./Chevron.js";
import { useState } from "react";
import { useProjection, useSend } from "@lloyal-labs/ui";
import type { AppState } from "../state.js";
import type { Command } from "../../protocol.js";
const names: Record<string, string> = {
  web: "Web",
  documents: "Documents",
  corpus: "Corpus",
  wikipedia: "Wikipedia",
};
const descriptions: Record<string, string> = {
  web: "Search and read web sources",
  documents: "Read attached PDFs, pages and figures",
  corpus: "Search a configured Markdown collection",
  wikipedia: "Look up encyclopedic references",
};
type Field = {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  enum?: string[];
  items?: { type?: string };
};
export function Abilities({
  excluded,
  onExcluded,
}: {
  excluded: string[];
  onExcluded(names: string[]): void;
}) {
  const abilities = useProjection((s: AppState) => s.abilities),
    send = useSend<Command>();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null),
    [open, setOpen] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null),
    [values, setValues] = useState<Record<string, unknown>>({});
  const current = abilities.find((a) => a.name === configuring);
  const schema = current?.configSchema as
    { properties?: Record<string, Field> } | undefined;
  const fields = Object.entries(schema?.properties ?? {});
  function close() {
    setOpen(false);
    setConfiguring(null);
    setValues({});
  }
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="gc-picker"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Abilities <Chevron />
      </button>
      <ComposerPopover
        anchor={anchor}
        open={open}
        onClose={close}
        key={current?.name ?? "abilities"}
        width={current ? 360 : 320}
        label={
          current
            ? (names[current.name] ?? current.title) + " settings"
            : "Abilities"
        }
      >
        <div className="glass-pop">
          {current ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (Object.keys(values).length)
                  send({
                    type: "set_ability_config",
                    name: current.name,
                    values,
                  });
                close();
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setConfiguring(null);
                  setValues({});
                }}
              >
                ← Abilities
              </button>
              <h3>{names[current.name] ?? current.title}</h3>
              {fields.map(([name, f]) => (
                <label key={name}>
                  {f.title ??
                    (name === "tavilyKey"
                      ? "Tavily API key"
                      : name.replace(/([a-z])([A-Z])/g, "$1 $2"))}
                  {f.enum ? (
                    <select
                      aria-label={
                        f.title ??
                        (name === "tavilyKey" ? "Tavily API key" : name)
                      }
                      value={String(values[name] ?? "")}
                      onChange={(e) =>
                        setValues((v) => {
                          const next = { ...v };
                          if (e.target.value === "") delete next[name];
                          else next[name] = e.target.value;
                          return next;
                        })
                      }
                    >
                      <option value="">Keep current</option>
                      {f.enum.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  ) : f.type === "boolean" ? (
                    <select
                      aria-label={
                        f.title ??
                        (name === "tavilyKey" ? "Tavily API key" : name)
                      }
                      value={String(values[name] ?? "")}
                      onChange={(e) =>
                        setValues((v) => {
                          const next = { ...v };
                          if (e.target.value === "") delete next[name];
                          else next[name] = e.target.value === "true";
                          return next;
                        })
                      }
                    >
                      <option value="">Keep current</option>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  ) : (
                    <input
                      type={
                        /key|secret|token/i.test(name)
                          ? "password"
                          : f.type === "number"
                            ? "number"
                            : "text"
                      }
                      aria-label={
                        f.title ??
                        (name === "tavilyKey" ? "Tavily API key" : name)
                      }
                      value={
                        Array.isArray(values[name])
                          ? (values[name] as string[]).join(", ")
                          : String(values[name] ?? "")
                      }
                      autoComplete="off"
                      placeholder={
                        current.config[name]
                          ? "Configured · leave unchanged"
                          : (f.description ?? "")
                      }
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [name]:
                            f.type === "number"
                              ? Number(e.target.value)
                              : f.type === "array"
                                ? e.target.value
                                    .split(",")
                                    .map((x) => x.trim())
                                    .filter(Boolean)
                                : e.target.value,
                        }))
                      }
                    />
                  )}
                  {current.config[name] === true &&
                    /key|secret|token/i.test(name) && (
                      <button
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, [name]: "" }))}
                      >
                        Clear stored value
                      </button>
                    )}
                </label>
              ))}
              <p>Changes apply when work next acquires this ability.</p>
              <button type="submit" className="glass-primary">
                Save
              </button>
            </form>
          ) : (
            <>
              {abilities.map((a) => (
                <div className="glass-ability" key={a.name}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={a.enabled && !excluded.includes(a.name)}
                    onClick={() => {
                      if (!a.enabled) {
                        setConfiguring(a.name);
                        return;
                      }
                      onExcluded(
                        excluded.includes(a.name)
                          ? excluded.filter((n) => n !== a.name)
                          : [...excluded, a.name],
                      );
                    }}
                  >
                    <span aria-hidden="true">
                      {a.enabled && !excluded.includes(a.name) ? "✓" : "○"}
                    </span>
                    <span>
                      {names[a.name] ?? a.title}
                      <small>
                        {a.enabled
                          ? (descriptions[a.name] ?? a.description)
                          : "Needs configuration"}
                      </small>
                    </span>
                  </button>
                  {!!a.configSchema && (
                    <button
                      type="button"
                      aria-label={(names[a.name] ?? a.title) + " settings"}
                      onClick={() => {
                        setConfiguring(a.name);
                        setValues({});
                      }}
                    >
                      ⚙
                    </button>
                  )}
                </div>
              ))}
              <p>
                Sources for your next message. PDFs use Documents; Corpus reads
                Markdown.
              </p>
            </>
          )}
        </div>
      </ComposerPopover>
    </>
  );
}
