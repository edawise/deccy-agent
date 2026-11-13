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
- `depends_on` names the decisions this node takes as given: `A → B` means A takes B's decision
  as given and adds only what B has not already decided; A does not re-decide B. The edge runs
  from the node that adds to the decision it does not re-decide. It is not provenance: what the
  author read or cited belongs in the rationale.
- `evaluates` (evaluation → decision/evaluation) names the subject whose addition is checked.
  A node born by `deccy new ... --evaluates <id>` is already `kind: evaluation` with exactly that
  relation; the author fills the content, it does not re-type the kind.

A node is born decision-shaped by default. The `--evaluates` flag is what makes an evaluation,
and a decision carries no `evaluates` key at all (not `[]`).

Before writing an edge, answer three questions:

1. What did I only read? That is a citation, not an edge.
2. What does A add that B does not decide? If nothing, A is a restatement: refine B's node, or
   reverse the edge if A is the explicit standard B's artifact embodies.
3. Which endpoint is the standard? If A is the explicit form of B's artifact, B takes A as
   given: the edge is B → A, not A → B.

An evaluation takes the standard as given and evaluates the subject; it never depends on its own
subject.

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
  never carry `evaluates`, and their `depends_on` targets are decisions (or `zzzzzzzz`), never
  evaluations.
- **I3. Every evaluation has ≥1 `evaluates`.** Evaluations may additionally carry `depends_on`;
  those targets are the decisions whose rules the check applies, never the evaluation's own
  subject.
- **I4. Eval sandwich.** Every `depends_on` edge `A → B` between decisions is covered by ≥1
  evaluation `E` with `E.evaluates ∋ A` and `E.depends_on ∋ B`. `E` checks that A adds only what
  B has not already decided and does not re-decide B; `E.depends_on` never contains
  `E.evaluates`. One `E` may cover several edges, but coverage must be complete. Expect more
  evaluation nodes than decisions.
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
deccy drafts                 # draft work state: handle, state, workspace
```

In deccy-cli v0.2.2 `deccy validate` checks the embedded schema, resolves every edge, and checks
I4 coverage. It does not check topological order or content custody; the two read-only scripts in the deccy-core skill
directory's `scripts/` do that. That directory is `~/.config/opencode/skills/deccy-core` for
OpenCode, `~/.claude/skills/deccy-core` for Claude Code, `~/.agents/skills/deccy-core` for Codex,
`~/.pi/agent/skills/deccy-core` for Pi, or `<project>/.claude/skills/deccy-core` /
`<project>/.opencode/skills/deccy-core` / `<project>/.agents/skills/deccy-core` /
`<project>/.pi/skills/deccy-core` when linked per-project.

## Drafts are not nodes

A draft is isolated work state (`.deccy/work/<handle>.json` plus a jj workspace), not a change in
the graph. It becomes graph content only when `deccy record --from <handle> --to <node>` lands it.
Evaluations, decisions and edges never name a draft handle; they name change ids.

## What the graph is for

The graph is the durable record of *why* the repository is the way it is. Code without a node is an
undocumented decision; a node whose rationale argues a different decision is a misplaced node.
When explaining a change, cite the node change id, not the commit id.
