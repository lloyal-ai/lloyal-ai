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
          ...source,
          url: address,
          icon: webAddress(source.icon),
        });
      }
    }
  return [...sources.values()];
}
