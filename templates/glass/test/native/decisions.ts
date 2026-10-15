/** Real decision policy through the public HDK. CUDA-only; no native/addon access. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ensure, scoped } from "effection";
import { bootEdge } from "@lloyal-labs/rig/node";
import {
  initializeHarness,
  participating,
  HarnessExit,
} from "@lloyal-labs/rig";
import { Ingress, waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { abilities, config } from "../../src/app.js";
import { decide } from "../../src/harness/decisions.js";
import { render } from "../../src/harness/prompts.js";
import type { Command, WorkflowEvent } from "../../src/protocol.js";
import { cases, corpusVersion } from "../eval/decisions/cases.js";
import { score, compare, type Result } from "../eval/decisions/score.js";

const { values } = parseArgs({
  options: {
    cases: { type: "string" },
    seeds: { type: "string", default: "7,42" },
    out: { type: "string" },
    baseline: { type: "string" },
  },
});
const selectedIds = values.cases?.split(",");
const selected = cases.filter(
  (c) => !selectedIds || selectedIds.includes(c.id),
);
assert(
  selected.length &&
    (!selectedIds || selectedIds.every((id) => cases.some((c) => c.id === id))),
  "Unknown or empty case selection",
);
const seeds = values.seeds!.split(",").map(Number);
assert(
  seeds.length &&
    new Set(seeds).size === seeds.length &&
    seeds.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffffffff),
  "Seeds must be unique unsigned 32-bit integers",
);
assert(
  !process.env.LLOYAL_GPU || process.env.LLOYAL_GPU === "cuda",
  "This suite requires CUDA",
);
assert(
  !process.env.LLOYAL_NO_FALLBACK || process.env.LLOYAL_NO_FALLBACK === "1",
  "CPU fallback must be disabled",
);
assert(
  process.env.LLOYAL_LOCAL !== "1",
  "Use the locked released CUDA package, not a local native build",
);
process.env.LLOYAL_GPU = "cuda";
process.env.LLOYAL_NO_FALLBACK = "1";
process.env.LLOYAL_DEV = "1";
function smi(query: string) {
  return execFileSync("nvidia-smi", [query, "--format=csv,noheader,nounits"], {
    encoding: "utf8",
    timeout: 10000,
  }).trim();
}
const gpu = smi("--query-gpu=name,uuid,driver_version");
assert(gpu, "No NVIDIA GPU found");
const initialProcesses = smi(
  "--query-compute-apps=pid,gpu_uuid,used_gpu_memory",
);
const root = resolve(import.meta.dirname, "../..");
const out = resolve(
  values.out ??
    `verification/decisions/${new Date().toISOString().replaceAll(":", "-")}`,
);
mkdirSync(resolve(out, ".."), { recursive: true });
mkdirSync(out); // Never overwrite a previous baseline.
const hash = (file: string) =>
  createHash("sha256")
    .update(readFileSync(join(root, file)))
    .digest("hex");
const corpusHash = createHash("sha256")
  .update(JSON.stringify(cases))
  .digest("hex");
const promptHashes = Object.fromEntries(
  ["decision.system", "decision.user", "boundary"].map((n) => [
    n,
    hash(`src/harness/prompts/${n}.eta`),
  ]),
);
const sourceHashes = Object.fromEntries(
  [
    "src/domain/work.ts",
    "src/harness/decisions.ts",
    "test/native/decisions.ts",
    "test/eval/decisions/score.ts",
  ].map((f) => [f, hash(f)]),
);
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const packages = Object.fromEntries(
  ["rig", "sdk", "lloyal-agents", "lloyal.node", "media", "dev-tools"].map(
    (p) => [
      p,
      JSON.parse(
        readFileSync(
          join(root, "node_modules/@lloyal-labs", p, "package.json"),
          "utf8",
        ),
      ).version,
    ],
  ),
);
const results: Result[] = [];
const baseline = values.baseline
  ? JSON.parse(readFileSync(values.baseline, "utf8"))
  : undefined;
const metadata = {
  corpusVersion,
  corpusHash,
  promptHashes,
  sourceHashes,
  packages,
  git: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain", "--untracked-files=no"),
  node: process.version,
  platform: process.platform,
  gpu,
  initialProcesses,
  dev: true,
  lockHash: hash("package-lock.json"),
  startedAt: new Date().toISOString(),
  seeds,
  cases: selected.map((c) => c.id),
};
writeFileSync(join(out, "fixtures.json"), JSON.stringify(selected, null, 2));
writeFileSync(join(out, "metadata.json"), JSON.stringify(metadata, null, 2));

bootEdge<typeof config, WorkflowEvent, Command>(
  {
    config,
    abilities,
    *harness(ctx, events) {
      const { session, runner, registry } = yield* initializeHarness(
        ctx,
        events,
        { abilities, config },
      );
      const model = runner.config().model;
      assert.equal(model.llm?.gpu, "cuda", "Resolved model must use CUDA");
      const allocation = smi(
        "--query-compute-apps=pid,gpu_uuid,used_gpu_memory",
      );
      assert(
        allocation.split("\n").some((line) => {
          const [pid, , mib] = line.split(",").map((s) => s.trim());
          return Number(pid) === process.pid && Number(mib) > 0;
        }),
        "Eval process has no CUDA allocation; refusing to run the matrix",
      );
      const modelHash = execFileSync("sha256sum", [model.llm!.path!], {
        encoding: "utf8",
      }).split(/\s/)[0];
      const environment = {
        ...metadata,
        model,
        modelHash,
        modelBytes: statSync(model.llm!.path!).size,
        allocation,
        pid: process.pid,
      };
      // Keep comparable decision conditions; prompt/source hashes are allowed to differ.
      const comparisonKey = {
        corpusHash,
        modelHash,
        model,
        packages,
        node: process.version,
        gpu,
        dev: true,
      };
      if (baseline)
        assert.deepEqual(
          baseline.comparisonKey,
          comparisonKey,
          "Baseline model, corpus, GPU, packages and configuration must match",
        );
      const write = () =>
        writeFileSync(
          join(out, "results.json"),
          JSON.stringify(
            {
              environment,
              comparisonKey,
              results,
              ...(baseline && results.length === selected.length * seeds.length
                ? { comparison: compare(baseline.results, results) }
                : {}),
            },
            null,
            2,
          ),
        );
      write();
      const ingress = yield* Ingress.expect();
      const fixtureAttachment = selected.some((c) => c.attachment)
        ? yield* waitUntilSettled(
            ingress.ingest(
              readFileSync(join(root, "test/fixtures/inspection.pdf")),
            ),
          )
        : undefined;
      for (const fixture of selected)
        for (const seed of seeds) {
          yield* scoped(function* () {
            yield* waitUntilSettled(session.dispose());
            for (const [q, a] of fixture.history ?? [])
              yield* waitUntilSettled(session.commitTurn(q, a));
            const refs = fixture.attachment ? [fixtureAttachment!] : [];
            const taking = yield* participating(
              registry
                .enabled()
                .map((a) => a.manifest.name)
                .filter((n) => !fixture.abilities.includes(n)),
              refs,
            );
            assert.deepEqual(
              taking.map((a) => a.manifest.name).sort(),
              [...fixture.abilities].sort(),
              `Required abilities unavailable for ${fixture.id}`,
            );
            const start = performance.now();
            const result: Result = {
              caseId: fixture.id,
              seed,
              ms: 0,
              firstTokenMs: null,
              tokens: 0,
              failures: [],
              rawOutput: "",
            };
            const trace = join(out, `${fixture.id}-${seed}.jsonl`);
            const unsubscribe = events.subscribe((event) => {
              const ms = performance.now() - start;
              appendFileSync(trace, JSON.stringify({ ms, event }) + "\n");
              if (event.type === "agent:produce") {
                result.rawOutput += event.text;
                result.firstTokenMs ??= ms;
                result.tokens = Math.max(result.tokens, event.tokenCount);
              }
            });
            yield* ensure(unsubscribe);
            try {
              result.decision = yield* decide(
                session.trunk,
                fixture.question,
                fixture.mode,
                taking,
                refs,
                fixture.evidence ? render("boundary", fixture.evidence) : "",
                false,
                fixture.boundary ?? "request",
                seed,
              );
              result.failures = score(
                fixture,
                result.decision,
                refs.map((a) => a.digest),
              );
            } catch (error) {
              result.error = String(error);
              result.failures = [result.error];
            }
            result.ms = performance.now() - start;
            results.push(result);
            write();
            console.error(
              `${result.failures.length ? "FAIL" : "PASS"} ${fixture.id}/${seed}: ${(result.ms / 1000).toFixed(2)}s ${result.failures.join("; ")}`,
            );
          });
        }
      yield* waitUntilSettled(session.dispose());
      const failed = results.filter((r) => r.failures.length);
      console.error(
        `Decision contracts: ${results.length - failed.length}/${results.length} passed; receipts: ${out}. Semantic review remains separate.`,
      );
      if (failed.length)
        throw new HarnessExit(
          `${failed.length} decision contract failures; see receipts`,
          1,
        );
    },
  },
  { argv: ["node", "decisions.ts", "--query", "decision evaluation"] },
);
