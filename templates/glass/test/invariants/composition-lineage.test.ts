import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness } from "./harness.js";
import type { Plan } from "../../src/domain/work.js";

// The public trace is the independent oracle: a finding ending at or before a
// worker's fork position entered that worker's inference context. Declared DAG
// edges alone cannot describe incidental inheritance from the shared spine.
for (const sequences of [4, 5, 8])
  for (const slowTicks of [24, 60])
    test(`revision withdraws inherited premises and keeps independent findings (${sequences} slots, ${slowTicks} ticks)`, async () => {
      const ids = [
        "first",
        "second",
        "third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth",
      ];
      const plan: Plan = {
        objective: "Check independent supplied facts",
        reason: "Check each fact",
        topology: "graph",
        presentation: "prose",
        review: true,
        preflight: false,
        revisit: false,
        inputs: [],
        tasks: ids.map((id) => ({
          id,
          title: id,
          instruction: `Check ${id}`,
          ability: "",
          dependsOn: [],
        })),
      };
      let turnId = "",
        revision = 0,
        retained: string[] = [];
      const r = await runHarness({
        nSeqMax: sequences,
        utterances: [
          {
            kind: "text",
            text: JSON.stringify({
              action: "compose",
              reason: plan.reason,
              presentation: plan.presentation,
              clarification: "",
              sourceScope: null,
              plan,
            }),
          },
          ...ids.map((id, i) => ({
            kind: "report" as const,
            text: `Finding ${id}`,
            stallTokens: i === 0 || i >= ids.length - 2 ? 1 : slowTicks,
          })),
        ],
        observe: (e) => {
          if (e.type === "work:start") turnId = e.turnId;
          if (e.type === "work:plan") {
            revision = e.state.revision;
            if (revision === 2) retained = e.state.retained;
          }
        },
        script: [
          {
            send: {
              type: "submit_query",
              query: plan.objective,
              mode: "Graph",
            },
          },
          {
            on: (e) => e.type === "work:plan" && e.state.awaitingApproval,
            send: () => ({ type: "approve_plan", turnId, revision }),
          },
          {
            on: (e) =>
              e.type === "work:outcome" && e.id === "eighth" && e.accepted,
            send: () => ({
              type: "revise_plan",
              turnId,
              revision,
              plan: {
                ...plan,
                tasks: plan.tasks.map((t) =>
                  t.id === "first"
                    ? { ...t, instruction: "Changed premise" }
                    : t,
                ),
              },
            }),
          },
          { on: (e) => e.type === "work:plan" && e.state.revision === 2 },
        ],
      });
      const extension = r.trace.find(
        (e) =>
          e.type === "spine:extend" && e.assistantContent === "Finding first",
      );
      assert.ok(extension && extension.type === "spine:extend");
      const accepted = r.events
        .filter((e) => e.type === "work:outcome" && e.accepted)
        .map((e) => e.id);
      const inherited: string[] = [],
        independent: string[] = [];
      for (const id of accepted.filter((id) => id !== "first")) {
        const spawned = r.events.find(
          (e) => e.type === "agent:spawn" && e.key === id,
        );
        assert.ok(spawned && spawned.type === "agent:spawn");
        const fork = r.trace.find(
          (e) =>
            e.type === "branch:create" && e.branchHandle === spawned.agentId,
        );
        assert.ok(fork && fork.type === "branch:create");
        (fork.position >= extension.positionAfter
          ? inherited
          : independent
        ).push(id);
      }
      assert.ok(
        inherited.length > 0,
        "The fixture must exercise queued inheritance",
      );
      assert.ok(
        independent.length > 0,
        "The fixture must also retain genuinely independent work",
      );
      assert.deepEqual(
        [...retained].sort(),
        independent.sort(),
        `Inherited findings must be withdrawn: ${inherited.join(", ")}`,
      );
    });
