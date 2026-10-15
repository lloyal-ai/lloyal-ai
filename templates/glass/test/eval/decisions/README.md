# Decision evaluations

This suite calls Glass's production `decide` operation, Eta prompts, typed grammar and validator through the public HDK. It uses Qwen3.5-4B on CUDA, actual signed ability catalogs, public PDF ingress and a real inherited conversation trunk. It does not execute proposed worker plans or call external search services. Deterministic execution contracts remain in `test/invariants/`; `test/native/host-journey.ts` exercises complete hosted turns.

## Run on an isolated GPU project

Install the locked dependencies with `npm ci`. Prepare a separate project directory so eval media/traces cannot enter the live conversation library. Give its `harness.yml` the intended models, with explicit paths to already provisioned files:

```yaml
model:
  llm:
    id: qwen3.5-4b
    path: /absolute/path/to/qwen3.5-4b.gguf
    gpu: cuda
    context: 16384
    branches: 4
  reranker:
    id: qwen3-reranker-0.6b-q8
    path: /absolute/path/to/qwen3-reranker-0.6b-q8.gguf
  vision:
    path: /absolute/path/to/qwen3.5-4b-mmproj.gguf
sources:
  outputDir: conversations
```

```sh
LLOYAL_PROJECT_ROOT=/absolute/path/to/isolated-project npm run eval:decisions -- \
  --out verification/decisions/baseline

LLOYAL_PROJECT_ROOT=/absolute/path/to/isolated-project npm run eval:decisions -- \
  --out verification/decisions/candidate \
  --baseline verification/decisions/baseline/results.json
```

The runner forces `LLOYAL_GPU=cuda`, `LLOYAL_NO_FALLBACK=1` and `LLOYAL_DEV=1`; conflicting backend/fallback settings fail before boot. The binding already requests full layer offload (`n_gpu_layers = -1`); there is no Glass `n_gpu` knob. A resolved CUDA configuration **and an allocation belonging to the eval PID in `nvidia-smi`** are required before any cases run. Missing CUDA/abilities fail loudly. Do not substitute a smaller CPU model and call that the decision-quality gate.

Dev mode preserves the public trace events, including prompts, token samples and host resources, in each case's JSONL. For interactive inspection, `npm run dev:web` enables the public dev pane; use a separate host and conversation directory. This batch runner does not need a browser or a second inference server.

Defaults: every case, seeds 7 and 42, temperature 0.2 from production `decide`. `--cases ordinary-explanation,manual-graph --seeds 7,42,99` selects a bounded subset. Unknown cases, duplicate/invalid seeds and existing output directories fail. Runs write results after every case, retain errors, and exit nonzero for any contract failure. Infrastructure failures abort without pretending the remaining cases ran.

## What is scored

The versioned corpus covers ordinary explanations/writing, supplied premises, manual modes, dependent steps, landscape/fanout, missing files/tools, a real PDF, restricted sources, inherited recall, completed revisits and an unresolved revisit. Expectations allow multiple useful actions/topologies where appropriate. Explicitly requested step counts and dependency edges are checked where they are part of the task. These are contract assertions, not a universal topology classifier or a single shape-accuracy percentage.

A null source scope preserves all available sources; it does not mean no tools. The grader tests this distinction, attachment retention, alternate valid topologies, missing handoffs and invalid baseline matching with deterministic counterexamples.

`results.json` records decisions, failures, first-token latency, decision latency and generated token counts. Metadata records corpus/prompt/source hashes, model checksum/configuration, installed package versions, Node, GPU/driver, dev mode and Git identity. Initial GPU processes are recorded to expose competing workloads. Cold boot, model hashing, PDF ingestion and history prefill are outside per-decision latency. Dev tracing is enabled for both baseline and candidate; these timings are not uninstrumented production benchmarks.

Comparison requires the same corpus, model, runtime/configuration, GPU and exact case/seed set. It reports regressions/recoveries and paired latency deltas. Change prompts on a branch, keep baseline outputs immutable, and rerun the same matrix; then use unseen paraphrases/seeds before claiming improvement generalizes. Changing a criterion requires a new corpus version, not retroactively loosening a failed baseline.

## Human review, separate from contract results

For every generated proposal, inspect the raw decision and trace beside the fixture's `review` note:

- Is additional work necessary? Are there duplicate investigations or a redundant final-summary task?
- Do prerequisites pass useful findings? Can worker instructions actually use what earlier workers discover?
- Does the approach cover the request without invented premises, unavailable evidence or silently relaxed constraints?
- On revisit, does it stop when sufficient and address only the unresolved gap otherwise?
- Are review/presentation choices useful, and is decision overhead justified?

Record pass/concern/fail with a concrete reason. Answer quality, citation correctness, refusal quality and user suitability require subsequent **execution** and human review; this suite's decision objects alone cannot establish them. Keep those gates open even when every automated contract passes.
