# The deccy model

A **deccy graph** is a directed acyclic graph where **one change = one node = one decision**.
The graph is stored in the repository: `nodes/<change-id>.json`, one JSON document per node.
`deccy` embeds the schema; there is no schema file to read.

## Kinds

- **`decision`** — one decided unit of work: what was decided and why.
- **`evaluation`** — review criteria, tests or other quality checks. An evaluation describes
  *how* a check is done; it does not record an outcome or verdict.

## Node content

A node carries:

```json
{
  "kind": "decision",
  "content": {
    "type": "text",
    "ref": "inline",
    "rationale": "...",
    "content": "..."
  },
  "depends_on": ["..."],
  "evaluates": ["..."]
}
```

- `content.type` names the format of the content: `text`, `ears`, `visual-spec`, `json-schema`,
  `test`, `review-criteria`, and others as projects invent them. The schema keeps types open.
- `content.ref` is either `"inline"` (with the body in `content.content`) or a list of
  repo-relative paths carrying the content (source files, schemas, tests, documents). A node
  records *what and why*; the code stays in the files.
- `content.rationale` says why the decision or check is the right one.
- `depends_on` (decision → decision/evaluation) declares a prerequisite.
- `evaluates` (evaluation → decision/evaluation) declares what is evaluated.

## Identifiers

- Node filenames and every edge endpoint use **change ids**.
- Change ids are stable across rebases; commit ids are not.
- The root id is `zzzzzzzz`; a root decision (one with no other prerequisite) depends on it.
- Address a node by its change id everywhere: `deccy show <id>`, `--on <id>`, `--to <id>`.

## Invariants

The target model — enforce it even when the current graph falls short:

- **I1. One change = one node = one decision.** Never two decisions in one change; never one
  decision split across two changes.
- **I2. Every decision has ≥1 `depends_on`.** Root decisions depend on `zzzzzzzz`. Decisions
  never carry `evaluates`.
- **I3. Every evaluation has ≥1 `evaluates`.** Evaluations may additionally carry `depends_on`.
- **I4. Eval sandwich.** Every `depends_on` edge `A → B` between decisions is covered by ≥1
  evaluation `E` with `E.evaluates ∋ A` and `E.depends_on ∋ B`. `E` checks that *A's use of B is
  sound*. One `E` may cover several edges, but coverage must be complete. Expect more evaluation
  nodes than decisions.
- **I5. Evaluations describe the check, not the outcome.** No verdicts, pass/fail state or
  session evidence in a node.
- **I6. Content custody.** A change never modifies files listed in another node's `ref` or
  another node's `nodes/<id>.json`. The file carries that node's content; the change carries its
  own node's content and nothing else's.

## Reading the graph

```sh
deccy log                    # every node: <id> <kind> <summary>
deccy show <id>...           # a node's stored document as pretty JSON
deccy validate               # validity, edge resolution, I4 coverage; silent when clean
```

`deccy validate` checks the embedded schema, resolves every edge, and checks I4 coverage. It does
not check topological order or content custody; the two read-only scripts in `scripts/` do that.

## What the graph is for

The graph is the durable record of *why* the repository is the way it is. Code without a node is an
undocumented decision; a node whose rationale argues a different decision is a misplaced node.
When explaining a change, cite the node change id, not the commit id.
