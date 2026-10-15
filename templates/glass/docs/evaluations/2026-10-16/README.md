# CUDA decision evaluation — 16 October 2026

The frozen final candidate passes all **57 automated contract checks**: 19 requests at seeds 7, 42 and 99. This is a small diagnostic corpus, not a claim of general reasoning quality. Seed 99 was run after the final prompt was frozen; the requests themselves were already in the development corpus.

| Run                                                 | Seeds | Contract passes | Median decision time |
| --------------------------------------------------- | ----- | --------------- | -------------------- |
| [Baseline](baseline.json)                           | 7, 42 | 26/38           | 3.41 s               |
| [First prompt candidate](candidate-1.json)          | 7, 42 | 35/38           | 2.74 s               |
| [Final prompt + Parallel grammar](candidate-2.json) | 7, 42 | 38/38           | 3.63 s               |
| [Frozen candidate, additional seed](seed-99.json)   | 99    | 19/19           | 3.31 s               |

The corpus and expectations stayed unchanged. The baseline missed source restrictions, added an extra chain step, refused available arithmetic work, generated dependencies inside a parallel plan, over-orchestrated a focused PDF question and treated an incomplete revisit as finished. Candidate 1 recovered those cases but regressed attachment retention twice and generated a forbidden Parallel dependency. The final revision distinguishes file references from typed-in premises and encodes empty dependencies directly in Parallel's generation grammar.

A deterministic counterexample for that grammar gap failed before its implementation changed (test-first commit `20d958f`) and passed afterward. The earlier execution regression commit `e3ac40f` produced 17 failures and nine positive controls against the unchanged application. The final application has 78 passing invariants, passing target/eval typechecks and passing web/desktop builds. The matching CLI has passing typecheck and 91 focused scaffold/template tests.

## Environment and evidence boundary

NVIDIA L40S, driver 565.57.01; Node 24.15.0; Qwen3.5-4B Q4_K_M, context 16,384, four branches, matching vision projector and Qwen3 reranker. Each result file records the exact model checksum, resolved configuration, installed package versions, source/prompt hashes, Git identity and evaluation PID's GPU allocation. The eval uses an isolated Brev project and conversation/media directory.

`model.llm.gpu=cuda` / `LLOYAL_GPU=cuda` selects CUDA; `LLOYAL_NO_FALLBACK=1` prevents silent CPU fallback. The runner refuses a missing NVIDIA device, incompatible flags or an eval PID with no GPU allocation. [lloyal.node v4.0.0 already requests `n_gpu_layers = -1`](https://github.com/lloyal-ai/lloyal.node/blob/v4.0.0/src/SessionContext.cpp#L2094); there is no additional Glass layer-offload flag. During the baseline, an external `nvidia-smi` check observed the eval PID holding 7,428 MiB and GPU utilization at 17%. The binding's normal log level did not print an offloaded-layer count; full-offload intent is grounded in the released source, and actual GPU use is checked independently.

`LLOYAL_DEV=1` was enabled throughout. Per-case JSONL captures the real public prompt/token/trace events and host resource samples. Raw generated text is included in these published JSON receipts, including validator failures. The [full dev JSONL archive](dev-traces.tar.gz) preserves the isolated run artifacts. The baseline and first-candidate prompt files beside this report match their recorded SHA-256 hashes; the final template is in `src/harness/prompts/decision.system.eta`.

Latencies exclude boot, hashing, ingestion and history reconstruction. They include dev instrumentation; CPU build checks briefly overlapped part of candidate 2. Treat these as diagnostic decision costs, **not a speedup benchmark**. No external search was executed, no generated worker plan was executed by this suite, and no native addon API was called by Glass.

An earlier eight-case revisit check ran on CPU because GPU selection was unset. It is not counted here. The same focused cases were subsequently checked on CUDA, followed by the full matrices above.

## Proposal review beyond structural checks

Inspection of the final outputs found:

- Initial simple requests stay with one agent. Supplied-facts and file-only cases preserve the intended source restriction. Completed revisits stop; incomplete revisits schedule only C, preserving A and B.
- Manual chain and graph proposals carry useful prerequisite handoffs. Parallel plans keep independent checks. Plan mode keeps review enabled. The survey cases choose fanout and depend on the landscape.
- **A semantic concern remains:** at seed 99, the landscape/fanout proposal preselects lithium-ion and flow batteries before the survey has selected its promising approaches. Seeds 7 and 42 instead refer to the first and second approaches identified by the survey. Both shapes pass the structural gate, but the seed-99 plan partially predetermines a discovery the request wanted to emerge from evidence. This remains a proposal-quality acceptance issue; it was not hidden by changing the test or retuning against the additional seed.

The remaining gate needs unseen request paraphrases, executed evidence/answer checks and human assessment of usefulness, suitability and source quality. In particular, a schema-valid fanout is not proof that task scope emerges from its landscape. These results do not close the whole Phase 1 release or quality gate.

See the [suite instructions and rubric](../../../test/eval/decisions/README.md) for reproducible runs and paired comparisons. Expectations accept equivalent useful shapes where appropriate; there is no universal single-topology accuracy target.
