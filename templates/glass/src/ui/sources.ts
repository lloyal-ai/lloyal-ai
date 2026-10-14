import type { AgentRuntime, SourceMeta } from "@lloyal-labs/ui/fold";

export function webAddress(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    return /^(https?:)$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Only tool-returned metadata; a search hit is not evidence that a page was read. */
export function returnedSources(agents: Iterable<AgentRuntime>): SourceMeta[] {
  const sources = new Map<string, SourceMeta>();
  for (const agent of agents)
    for (const item of agent.timeline ?? []) {
      if (item.kind !== "tool_result") continue;
      for (const source of item.sources ?? []) {
        const address = webAddress(source.url);
        const url = address ? new URL(address) : null;
        if (url) url.hash = "";
        const key = url?.href ?? JSON.stringify([source.host, source.title]);
        if (!address && !source.host && !source.title) continue;
        sources.set(key, {
          ...sources.get(key),
          ...Object.fromEntries(
            Object.entries(source).filter(([, value]) => value !== undefined),
          ),
          url: address,
          icon: webAddress(source.icon) ?? sources.get(key)?.icon,
        });
      }
    }
  return [...sources.values()];
}

export type ProgressSource = SourceMeta & { opening?: boolean };

/** A dispatched URL is visible before its result; it is not yet evidence. */
export function requestedSource(
  tool: string,
  args: string,
): string | undefined {
  if (tool !== "fetch_page" && tool !== "web_fetch") return;
  try {
    const value: unknown = JSON.parse(args);
    if (
      typeof value !== "object" ||
      value === null ||
      !("url" in value) ||
      typeof value.url !== "string"
    )
      return;
    return webAddress(value.url);
  } catch {
    return;
  }
}

export function sourceProgress(
  agents: Iterable<AgentRuntime>,
  requests: Record<number, string>,
): ProgressSource[] {
  const selected = [...agents];
  const sources: ProgressSource[] = returnedSources(selected);
  const page = (address: string) => {
    const url = new URL(address);
    url.hash = "";
    return url.href;
  };
  for (const agent of selected) {
    const url = requests[agent.id];
    if (!url) continue;
    const known = sources.find(
      (source) => source.url && page(source.url) === page(url),
    );
    if (known) known.opening = true;
    else sources.push({ url, host: new URL(url).hostname, opening: true });
  }
  return sources;
}
