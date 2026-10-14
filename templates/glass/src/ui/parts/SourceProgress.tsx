import { useState } from "react";
import type { ProgressSource } from "../sources.js";
import { Chevron } from "./Chevron.js";

function SourceIcon({ source }: { source: ProgressSource }) {
  const [failed, setFailed] = useState(false);
  const label = source.host || source.title || "Source";
  return (
    <span
      className="gc-source-icon"
      title={source.opening ? `Opening ${label}` : label}
      aria-hidden="true"
    >
      {source.icon && !failed ? (
        <img
          src={source.icon}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        label
          .replace(/^www\./, "")
          .slice(0, 1)
          .toUpperCase()
      )}
    </span>
  );
}

export function SourceProgress({ sources }: { sources: ProgressSource[] }) {
  if (!sources.length) return null;
  return (
    <details className="gc-source-progress">
      <summary>
        <span className="gc-source-icons">
          {sources.slice(0, 5).map((source, i) => (
            <SourceIcon key={source.url ?? i} source={source} />
          ))}
        </span>
        <span
          className="gc-source-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {sources.length} {sources.length === 1 ? "source" : "sources"}
          {sources.some((source) => source.opening) && " · opening…"}
        </span>
        <Chevron />
      </summary>
      <p>
        Sources appear as tools find or open them. “Opening” is a request in
        flight; search results may not have been read.
      </p>
      <ul>
        {sources.map((source, i) => (
          <li key={source.url ?? i}>
            <SourceIcon source={source} />
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title || source.host || source.url}
              </a>
            ) : (
              <span>{source.title || source.host}</span>
            )}
            {source.opening && <small>Opening…</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}
