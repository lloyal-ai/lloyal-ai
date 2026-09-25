# Prompts

Every word this app says to the model, in its own hand, is a file in this folder. Nothing is a string in code.
A file is a template with full JavaScript in it, rendered against what the harness knows at that moment, and
handed to the framework as text. The framework puts the text into the model's own chat format, with its role
markers, its thinking tags and its tool schemas, so a file here is model-agnostic: the same file serves Qwen
today and whatever the catalog names tomorrow. What you write is what the model reads, and nothing else.

Edit a file and ask again. The folder is read on every render, so a change is live at the next run with no
restart. The one exception is `instructions.ts` next door, which is read when a run starts.

## The files

A prompt is a pair: `<name>.system.eta` is the system prompt, `<name>.user.eta` the user turn, rendered with
the same input. A single turn is one file. Two files are not prompts but parts every prompt uses.

| file | who reads it | what it receives (`it.*`) |
|---|---|---|
| `framed.eta` | every system prompt, as its layout | `purpose`, `answers` from `instructions.ts`; `body`, the file that handed itself over; `writesTheAnswer` |
| `cite.eta` | an inquiry, as a partial, when its report takes sources | `tool`, the report tool's name |
| `plan` / `plan-flat` | the planner, once per ask | `query: string`, `count: number`, `date: string`, `routingKey: string`, `sources: { name, useWhen, toc: string \| null }[]`, `coverage: string \| null` |
| `preflight` | one probe per source, before the plan | `query: string`, `ability: { name, useWhen, tools: string[], contents: string \| null }` |
| `preflight-recover` | a probe reaped under budget | `budget: number`, the words it may still write |
| `inquiry.system` | every research agent | `preamble: string`, `takesSources: boolean`, `writesTheAnswer: boolean`, `tool: string` |
| `recovery` | an inquiry reaped under budget | `budget: number`, `tool: string`, `writesTheAnswer: boolean` |
| `synthesize` / `synthesize-flat` | the settling pass, findings on the spine / in the prompt | `query: string`; flat adds `findings: { task, body }[]` |
| `answer.system` | a direct answer from the trunk | nothing beyond the frame |
| `clarify` | the planner's questions, as the assistant's turn | `questions: string[]` |

`flat` is the findings-in-the-prompt variant, used when the spine does not hold them. `writesTheAnswer` is
true for the one agent whose words the reader gets, which is where `answers` from `instructions.ts` is said.

## What `it` is

`it` is one object: the instructions, spread first, then the caller's input on top. The caller is a stage in
`research.ts`, or the framework for what only it knows: a reaped agent's word budget, a probe's source. The
table above is the contract, and `test/invariants/prompts.test.ts` renders every file from it, so a key a file
reads that its input does not name fails `npm test` before any model loads.

At run time a missing key is not a lost run. It renders as the empty string, never as the word `undefined`,
and is reported as one line in the engine's log. Many inputs come from the framework, and an edge that
misfires must never cost a reader the run.

## What you can write

Templates are [Eta](https://eta.js.org): `<%= it.x %>` interpolates, `<% … %>` runs JavaScript, `<%~ … %>`
inserts text as it is. Escaping is off, since this is prose for a model, not HTML. Everything JavaScript can
say about the input is available, and the files use it today:

```eta
<% /* the first line of every system file: the frame it hands itself to, with the one fact the frame needs */ %>
<% layout("./framed", { writesTheAnswer: it.writesTheAnswer }) %>

<% /* a conditional part, present only when there is something to say */ %>
<% if (it.coverage) { %>
Source coverage: <%= it.coverage %>
<% } %>

<% /* a loop over the sources, each with what it advertises */ %>
<% for (const source of it.sources) { %>
### <%= source.name %>
<%= source.useWhen %>
<% if (source.toc) { %>Files and topics: <%= source.toc %><% } %>
<% } %>

<% /* computed text: numbers, plurals, joins */ %>
Emit 1-<%= it.count %> tasks<%= it.count === 1 ? "" : ", each one self-contained" %>.
Findings from <%= it.findings.length %> agents: <%= it.findings.map((f) => f.task).join("; ") %>

<% /* a partial, included only when it applies */ %>
<% if (it.takesSources) { %><%~ include("./cite") %><% } %>

```

A `layout` and an `include` each receive a copy of `it`, and the guard above covers those renders too.

## Two rules

- **Say nothing about the format.** No role markers, no `<think>`, no tool JSON. The framework adds the model's
  own, and a file that spells them is wrong for the next model.
- **Say nothing the harness does not know.** A worked example is fine; a fact the run did not surface is not,
  and the synthesis prompt's grounding rule says so to the model in its own words.
