import type { Decision } from "../../../src/domain/work.js";
import type { DecisionCase } from "./cases.js";

/** Contract checks, not a semantic-quality judge. A null scope preserves ALL available sources. */
export function score(
  fixture: DecisionCase,
  decision: Decision,
  inputs: readonly string[] = [],
): string[] {
  const e = fixture.expect;
  const failures: string[] = [];
  if (!e.actions.includes(decision.action))
    failures.push(
      `action ${decision.action}; expected ${e.actions.join(" or ")}`,
    );
  if (e.presentation && decision.presentation !== e.presentation)
    failures.push(
      `presentation ${decision.presentation}; expected ${e.presentation}`,
    );
  const allowed = decision.sourceScope?.abilities ?? fixture.abilities;
  if (
    e.allowedAbilities &&
    allowed.some((a) => !e.allowedAbilities!.includes(a))
  )
    failures.push(
      `source restriction leaves disallowed abilities: ${allowed.join(", ")}`,
    );
  if (e.retainAttachment) {
    const retained = decision.sourceScope?.inputs ?? inputs;
    if (!inputs.length || !inputs.every((id) => retained.includes(id)))
      failures.push("required attachment was not retained");
  }
  if (decision.action === "compose") {
    const p = decision.plan;
    if (e.topologies && !e.topologies.includes(p.topology))
      failures.push(
        `topology ${p.topology}; expected ${e.topologies.join(" or ")}`,
      );
    if (e.review !== undefined && p.review !== e.review)
      failures.push(`review must be ${e.review}`);
    if (e.tasks && (p.tasks.length < e.tasks[0] || p.tasks.length > e.tasks[1]))
      failures.push(
        `task count ${p.tasks.length}; expected ${e.tasks.join("–")}`,
      );
    if (
      e.minEdges &&
      p.tasks.reduce((n, t) => n + t.dependsOn.length, 0) < e.minEdges
    )
      failures.push("missing required prerequisite handoffs");
    if (
      e.minRoots &&
      p.tasks.filter((t) => !t.dependsOn.length).length < e.minRoots
    )
      failures.push("missing independent prerequisite checks");
  }
  return failures;
}

export interface Result {
  caseId: string;
  seed: number;
  ms: number;
  firstTokenMs: number | null;
  tokens: number;
  failures: string[];
  rawOutput?: string;
  decision?: Decision;
  error?: string;
}
export function compare(before: Result[], after: Result[]) {
  const key = (r: Result) => `${r.caseId}/${r.seed}`;
  const old = new Map(before.map((r) => [key(r), r]));
  if (
    old.size !== before.length ||
    new Set(after.map(key)).size !== after.length ||
    before.length !== after.length ||
    after.some((r) => !old.has(key(r)))
  )
    throw new Error(
      "Baseline must contain exactly the same case/seed pairs, without duplicates.",
    );
  return after.map((r) => {
    const b = old.get(key(r))!;
    return {
      caseId: r.caseId,
      seed: r.seed,
      change: b.failures.length
        ? r.failures.length
          ? "still failing"
          : "recovered"
        : r.failures.length
          ? "regressed"
          : "still passing",
      latencyDeltaMs: r.ms - b.ms,
    };
  });
}
