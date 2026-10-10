# Agent economics: measurement record

The [README figures](../../../README.md#agent-economics-attention-processes-vs-http-requests) show how memory grows as more agents work from a common context. This record describes the CUDA capacity diagnostic collected on 10 October 2026. It includes the setup, per-trial measurements and code to regenerate the figures.

## Matched result at 128 agents

Each agent performs a distinct, model-generated lookup from the same ~8.8k-token ledger. Both backends completed two rounds and returned 256/256 exact answers. There is one completed trial per backend at this width.

| Measurement | Lloyal | LangGraph + llama-server, prefix-cache enabled |
| --- | ---: | ---: |
| Concurrent agents observed | 128 | 128 |
| Allocated attention KV | 0.375732 GiB | 10.125000 GiB |
| Allocated recurrent state | 6.379395 GiB | 6.281250 GiB |
| Peak measured model/worker GPU memory | 10.417969 GiB | 24.001953 GiB |
| Configured sequences | 130 | 128 |
| Exact answers / requested answers | 256 / 256 | 256 / 256 |

The reductions are `100 × (1 − Lloyal / HTTP)`: **96.3% in attention KV allocation** and **56.6% in measured GPU memory**, at this agent count and context length. The GPU measurement includes recurrent state, model weights and other GPU allocations owned by the measured processes. It is not a recurrent-subtracted estimate.

The native trial is `cuda-capacity-default-2026-10-10/sweep-p256-n128-lloyal-r1`. The completed HTTP trial is `cuda-timeout-repair-2026-10-10/sweep-p256-n128-langgraph-r1`. The original HTTP attempt remains in the data as transport-censored.

## What the execution models change

Lloyal uses the public HDK `withSpine`, `agentPool` and `parallel` APIs. Agents fork the processed common context and receive private tasks. The pool advances inference through the native runtime and releases scoped branches at the end of each round.

The comparator uses LangGraph `StateGraph` and `Send`, with `ChatOpenAI` requests to llama-server. Each request carries the common ledger and its private task. The server has one slot per concurrent agent and uses separate KV streams (`--no-kv-unified`). Prefix-cache reuse is enabled. This layout reserves the attention prefix within each simultaneous slot.

The plots quantify these two configurations. HTTP and LangGraph do not intrinsically require this storage layout; a server with another KV layout or sharing policy is a different comparison.

### Recurrent state is a common model cost

Qwen3.5's hybrid architecture reserves **50.25 MiB of recurrent state per configured sequence** on both paths. Lloyal configures two additional administrative sequences, adding 100.5 MiB at a matched agent count. This component contributes no memory saving for Lloyal here.

The component chart draws attention allocation in color and recurrent allocation as separate dashed gray lines. Both components are direct engine counters. Their independently sampled peaks must not be added to, or subtracted from, the measured process GPU peak to infer a memory breakdown.

Total memory still grows with agent count. Shared attention reduces the cost of adding agents; private continuations, recurrent state and other allocations remain.

## Setup and controls

| Control | Configuration |
| --- | --- |
| GPU | One NVIDIA L40S, advertised 48 GB; NVML reports 46,068 MiB total |
| Host | 8 vCPU, approximately 144 GiB RAM, no swap; Ubuntu 22.04.5 |
| Runtime | Node.js 24.6.0; CUDA 12.6.85, architecture 89; NVIDIA driver 565.57.01 |
| Model | Qwen3.5-4B Q4_K_M, identical GGUF bytes in both arms |
| Inference engine | Same llama.cpp revision `d6d0ce8215a1c324e8de04b52f9dd65c5edc129f` |
| Native packages | `@lloyal-labs/agents` 6.0.0, SDK 4.0.0, Effection 4.1.1, `lloyal.node` 3.2.0 |
| HTTP packages | LangGraph 1.4.21, LangChain core 1.2.17, LangChain OpenAI 1.6.2 |
| KV format / batching | `q4_0` K and V; batch and microbatch 512 |
| Device placement | Full GPU offload, automatic fit disabled, no CPU fallback |
| Generation | Thinking disabled, greedy decoding, JSON schema, no retries |
| Workload | Two rounds of distinct exact ledger lookups; short private continuations |
| Media / tools | Text only; no projector, reranker or external tools in this diagnostic |
| Backend execution | Sequential runs on the same GPU |
| HTTP prefix-cache | `cache_prompt=true` on requests; `--cache-ram 1024`; one exact-checked priming lookup before the two parallel rounds |

Model SHA-256: `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`.

The source identities, instrumented binary hashes, source-diff hashes and fixture hashes are preserved in [measurements.json](measurements.json). Both inference paths include instrumentation for engine allocation and attention-cell accounting. Timing is exploratory because observer overhead and server prefix-cache management costs have not been isolated.

### Context budgets and concurrency

The short fixture contains 256 ledger records. Calibration measured 8,790 native text tokens and an 8,806-token shared HTTP prefix; the largest HTTP prompt was 8,819 tokens. A frozen bound of 8,918 tokens covers framing. The same ledger and task content are used on both paths; their fully formatted model prompts are not byte-identical.

For `n` concurrent agents, with `ceil256` rounding upward to a multiple of 256:

```text
Lloyal context cells = ceil256(prefixBound + n × 256 + 2048)
HTTP context cells  = n × ceil256(prefixBound + 256 + 2048 / n)
Lloyal sequences    = n + 2
HTTP slots         = n
```

These budgets allow each backend to hold the common context and a private continuation for every concurrent agent under its configured storage layout. At 128 agents, they reserve 43,776 native cells and 1,179,648 HTTP cells. Equal total context allocation would constrain the two layouts to different workloads.

Observed concurrency is the native pool's active-agent count or llama-server's processing-slot count, including prefill. It does not mean all agents execute GPU kernels simultaneously. The experiment allows 1,800 seconds per round; that bound is not an interactive latency target.

## Prefix-cache evidence

In the completed HTTP run at 128 agents, every request has a server receipt. `usage.prompt_tokens` equals `timings.cache_n + timings.prompt_n` on retained successful responses.

| Round | Responses | Input tokens | Tokens reused from prefix-cache | Reuse fraction |
| --- | ---: | ---: | ---: | ---: |
| First | 128 | 1,128,832 | 8,795 | 0.78% |
| Second | 128 | 1,128,832 | 1,125,760 | 99.73% |

The two rounds use the same lookup tasks. These receipts establish reuse of prefix computation. The memory charts measure simultaneous slot storage under the separate-stream configuration. The [published receipt aggregates](measurements.json) retain both rounds.

## Scope, other observations and incomplete attempts

The figures use all completed, non-calibration short-ledger trials, grouped by backend and agent count. Points are medians; whiskers show observed minima and maxima, often coincident. The native 254-agent point and HTTP 64-agent point each contain three completed trials. Other plotted short-ledger points contain one. Lines connect observations and do not estimate unmeasured counts. Incomplete attempts and startup allocation failures are retained in the data and excluded from the curves.

Lloyal completed 254 agents with 508/508 exact answers in each of three trials, at 17.42 GiB peak GPU memory. This reaches the 256-sequence software ceiling after two administrative sequences. HTTP startup allocation failed at 254 agents in three trials. The exact physical capacity frontier remains unknown; these observations do not establish a capacity multiplier.

Five original wide HTTP attempts hit an independent client response-header limit near 300 seconds. They were transport-censored, not evidence of GPU exhaustion. A corrective transport change aligned Undici, SDK and abort deadlines to 1,800 seconds. Two representative widths were rerun with unchanged model/server binaries, budgets and request bytes: 128 agents on the short ledger and 64 on the long ledger. The published inventory preserves both original and corrected outcomes. Short-ledger widths 152 and 192 and long-ledger width 80 remain censored.

The inventory also retains the ~26.8k-token long-ledger condition. At 64 agents, native used 7.15 GiB and HTTP used 27.99 GiB, with 124/128 and 125/128 exact answers respectively. Answer errors prevent treating that pair as fully correct useful capacity.

These diagnostic agents exercise shared context and concurrency with real model outputs. They are not complete Fieldnote sessions. The correctness check compares all four structured lookup fields (`id`, `route`, `capacity`, `checksum`) against the fixture; it does not measure open-ended synthesis quality. There is no dollar-cost reduction, general quality advantage, scheduler-only speedup or maximum-capacity ratio claimed here.

## Regenerate the figures

From the repository root, with Python 3.11 or newer:

```sh
python3 -m venv /tmp/lloyal-chart-env
/tmp/lloyal-chart-env/bin/pip install matplotlib==3.11.2
/tmp/lloyal-chart-env/bin/python guides/benchmarks/agent-economics/plot.py
```

The script checks the matched answer/concurrency gates and headline calculations, then writes the two PNGs under `.github/readme/`. It requires no model or GPU. Pixel-identical rendering can depend on the Python, font and Matplotlib environment; the published figures were rendered with Python 3.14 and Matplotlib 3.11.2.

This directory contains a projection of the measurement record and chart regeneration code. Full raw traces, generated answers, instrumentation patches and an independently runnable benchmark package are not included in this directory. The `sourceSha256` manifest identifies the retained source records; hashes alone are not an independent reproduction of the experiment.
