# Prompts

Every word this app says to the model, in its own hand, is a file in this folder. Nothing is a string in code.
A file is a template with full JavaScript in it, rendered against what the harness knows at that moment, and
handed to the framework as text. The framework puts the text into the model's own chat format, with its role
markers, its thinking tags and its tool schemas, so a file here is model-agnostic: the same file serves Qwen
today and whatever the catalog names tomorrow. What you write is what the model reads, and nothing else.

Edit a file and ask again. The folder is read on every render, so a change is live at the next question with
no restart. The one exception is `instructions.ts` next door, which is read when a run starts.

## The files

A prompt is a pair: `<name>.system.eta` is the system prompt, `<name>.user.eta` the user turn, rendered with
the same input. `framed.eta` is the one frame every system prompt hands itself to.

| file | who reads it | what it receives (`it.*`) |
|---|---|---|
| `framed.eta` | every system prompt, as its layout | `purpose`, `answers` from `instructions.ts`; `body`, the file that handed itself over; `writesTheAnswer` |
| `topics` | the agent that names the topics, once per question | `articles: string[]`, `smallestPile: number`, `tool: string` |
| `topic` | one agent per article, filing it under a topic | `topics: string[]`, `article: string` |
| `synthesize` / `synthesize-extend` | the writer, from the notes / extending a settled article | `query: string`, `notes: string` |

## What `it` is

`it` is one object: the instructions, spread first, then the caller's input on top. The caller is a stage in
`wiki.ts` or `classify.ts`. The table above is the contract, and `test/invariants/prompts.test.ts` renders every
file from it, so a key a file reads that its input does not name fails `npm test` before any model loads.

At run time a missing key is not a lost run. A top-level key the input does not name renders as the empty
string and is reported as one line in the engine's log (a key under a given object is that object's own, and
`undefined` there is plain JavaScript). Inputs can come from the framework, and an edge that misfires
must never cost a reader the run.

## What you can write

Templates are [Eta](https://eta.js.org): `<%= it.x %>` interpolates, `<% … %>` runs JavaScript, `<%~ … %>`
inserts text as it is. Escaping is off, since this is prose for a model, not HTML. Everything JavaScript can
say about the input is available:

```eta
<% /* the first line of every system file: the frame it hands itself to, with the one fact the frame needs */ %>
<% layout("./framed", { writesTheAnswer: true }) %>

<% /* a numbered list from an array */ %>
<% it.topics.forEach((t, i) => { %><%= i + 1 %>. <%= t %>
<% }) %>

<% /* computed text: counts, plurals, joins */ %>
<%= it.articles.length %> article<%= it.articles.length === 1 ? "" : "s" %>, the smallest pile <%= it.smallestPile %> strong.

<% /* a conditional part */ %>
<% if (it.notes.trim()) { %>Notes so far:
<%= it.notes %><% } %>

```

A `layout` receives a copy of `it`, and the guard above covers that render too.

## Two rules

- **Say nothing about the format.** No role markers, no `<think>`, no tool JSON. The framework adds the model's
  own, and a file that spells them is wrong for the next model.
- **Say nothing the harness does not know.** A worked example is fine; a fact the run did not surface is not.
