# Ralph-Loop End-to-End Gap Report

**Test setup**: `ElOrlis/ralph-demo-todo`, 4-task PRD covering deps, mixed criterion types, and human-in-the-loop. Run: `./ralph-loop ./prd.md --max-iterations 12 --verbose --repo ElOrlis/ralph-demo-todo` (initial + 3 `--resume` invocations).

**Headline**: every individual subsystem mostly works (Claude calls, git branching, dep merging, GitHub issue/PR/project creation, criteria verification). But the orchestration leaks — the script silently exits after each iteration, manual criteria auto-pass, issues never close, and PRs never flip to ready. End-to-end the loop completed all 4 tasks **only because we ran it 4 times by hand**, and the human-in-the-loop tasks were "approved" by Ralph itself with zero human input.

---

## CRITICAL — bugs that block real-world use

### G1. Silent exit after every successful iteration *(reproduced 4×)*
**Evidence**: every run, regardless of `--max-iterations`, processes exactly one task then exits 0.
```
[INFO] Committed <sha> on <branch> (status: passed)
jq: parse error: Invalid numeric literal at line 1, column 7
[WARN] Could not push <branch>:
jq: parse error: Invalid numeric literal at line 1, column 3
<EOF, exit 0>
```
**Cause** (likely): `set -euo pipefail` is on (ralph-loop:2). After `commit_iteration` succeeds, `push_task_branch` (ralph-loop:1572-1586) runs `node lib/git/index.js push` and pipes its output through `jq -r '.ok' 2>/dev/null || echo false`. If push fails (auth, network, etc.), the node script likely emits non-JSON to stderr/stdout — jq parse errors leak (the second `jq -r '.error'` at ralph-loop:1583 has no stderr suppression), and somewhere downstream a piped command's exit status combined with `pipefail` kills the script. The `local x=$(...)` idiom hides the exit but a downstream `echo … | jq …` after that is the actual trigger.
**Why exit 0 not non-zero?**: open question — possibly an explicit `return 0` or pipe trickery. Worth running under `bash -x` to nail the exact line.
**Impact**: the loop's whole value prop ("iterates until all tasks pass") doesn't work. Users have to babysit it with repeated `--resume` invocations. The `Max Iterations: 12` banner is a lie when only 1 ever runs.
**Fix priority**: **P0**. Until this is fixed, nothing else matters.
**Fix path**:
1. Reproduce under `bash -x ./ralph-loop …` and find the exact failing line.
2. Audit every `local x=$(... | jq ...)` chain — they hide errors and corrupt state silently. Use a wrapper `safe_jq() { jq "$@" || { echo "{}"; return 0; }; }` and gate downstream consumers on whether output is the empty object.
3. Long-term: convert PRD-state mutations into a single `lib/state/index.js` Node module with proper error handling, instead of `jq … > FILE` from bash.

### G2. PRD JSON state mutations can truncate the file
**Evidence**: at multiple points, the script does:
```bash
local updated=$(jq … "$JSON_FILE")
echo "$updated" | jq '.' > "$JSON_FILE"
```
If `jq` fails inside the `$(...)`, `updated` is empty. The shell still opens `$JSON_FILE` for `>` redirect (truncating it) **before** `jq` runs and errors out. Net effect: PRD JSON is wiped to empty mid-run. We didn't observe a wipe in this run (lucky), but the pattern is at lines 1632-1634, 3035, 3060, 3068, etc.
**Fix**: write to `$JSON_FILE.tmp` then `mv` only if non-empty and valid:
```bash
echo "$updated" | jq '.' > "$JSON_FILE.tmp" && [ -s "$JSON_FILE.tmp" ] && mv "$JSON_FILE.tmp" "$JSON_FILE"
```
Apply globally. **P0** (data-loss risk).

### G3. `manual` criteria auto-pass — there is no human gate at all
**Evidence**: `lib/criteria/runner.js:16-17` returns `{passed: null, skipped: true}`; `verifyCriteria` (runner.js:94-116) excludes `skipped` entries from the `allPassed` calculation. Verified empirically:
```js
verifyCriteria([{type:'manual', text:'a'}, {type:'manual', text:'b'}])
→ { passed: true, results: [{skipped:true},{skipped:true}] }
```
Real-run confirmation: task-4 (all-manual criteria) was marked `passes: true` by Ralph after Claude wrote ~5 bytes of "DONE", with **zero human review**.
**Impact**: Ralph's pitch as a co-developed human+AI workflow is broken. Every "Manual:" criterion in every PRD is a lie — it'll auto-pass.
**Fix sketch (substantive, not just a flag)**:
1. **Status state**: introduce `pending_review` task status alongside `ready`/`blocked`/`completed`. When all *non-manual* criteria pass but at least one `manual` remains, set `pending_review`, leave the issue open, leave the PR draft, and move on (don't block other ready tasks).
2. **Human verdict surface**: post a clear "Approve or reject" comment on the issue. Recognize verdicts via:
   - **CLI**: `./ralph-loop --approve <task-id>` and `./ralph-loop --reject <task-id> "<reason>"` mutate `criteriaResults[i] = {passed: true|false, approvedBy: <user>, approvedAt: <ts>, reason?}`.
   - **GitHub** (later): poll issue comments for `/approve` / `/reject <reason>` from the issue creator or repo owner.
3. **Resume integration**: when `--resume` runs, it should re-evaluate `pending_review` tasks: if all manual criteria now have approved verdicts, mark `passes: true` and close issue + ready PR.
4. **Audit trail**: store verdict provenance (`approvedBy`, `approvedAt`, `verdictSource: cli|comment`) so completion isn't just a Boolean flag.
**Fix priority**: **P0** if the human+AI story is core; otherwise rename `manual` to `informational` and stop pretending.

---

## HIGH — visible bugs that erode trust

### G4. `close_task_issue` silently fails *(every iteration in this run)*
**Evidence**: every passed task left its issue OPEN. The crosscheck warning fired on every `--resume`:
```
[WARN] Task task-1 is marked complete but issue #1 is still open
[WARN] Task task-2 is marked complete but issue #3 is still open
```
The verbose log "Closing issue #N" never appears, suggesting `close_task_issue` (ralph-loop:2583) was never reached because the script exited at G1 first.
**Fix**: G1 fix likely fixes this transitively. Add a guard rail anyway: at the start of every `--resume`, scan for `passes:true` tasks whose `issueNumber` is still OPEN and close them. Also add a top-level `--reconcile` flag for fixing drift without running iterations.

### G5. PRs never marked ready, even after task passes
**Evidence**: PRs #2 and #4 are still in DRAFT after both tasks passed.
**Cause**: same exit-after-push bug — `mark_pr_ready` is called at ralph-loop:3016 but never reached.
**Fix**: same as G1.

### G6. Markdown→JSON: invalid JSON on backslashes in regex
**Evidence**: criterion `[grep: "module\.exports.*loadTodos" in ./src/storage.js]` produces empty `prd.json` and `Failed to convert markdown to JSON - invalid JSON generated`.
**Cause**: ralph-loop:693, 786 escape `"` but not `\` when concatenating JSON.
**Fix**: rewrite encoding via `jq -n --argjson tasks "$tasks_json" '{title:$title, tasks:$tasks}'` end-to-end. Or at minimum apply backslash escape *first*: `${str//\\/\\\\}` then `${str//\"/\\\"}`. **P1**.

### G7. Markdown→JSON: blank line after `### Acceptance Criteria` swallows criteria
**Evidence**: the standard markdown style `### Acceptance Criteria\n\n- item` produces an empty `acceptanceCriteria` array. Validation catches the resulting state (`empty acceptanceCriteria array`), but if even one criterion landed before the blank line and the rest after, the rest would be silently dropped.
**Cause**: ralph-loop:733 flips `in_criteria=false` on any blank line.
**Fix**: only end the criteria section on a *new* `##`/`###` header, not on whitespace. **P1**.

### G8. No documented place for a task description in markdown
**Evidence**: every parsed task has `"description": ""`. The converter has a description-collection branch (ralph-loop:737) but no markdown convention exposes a slot for it. `--analyze-prd` flagged the missing descriptions but no fix is available to a user reading the docs.
**Fix**: document explicitly that paragraph text between `**Priority**: N` and `### Acceptance Criteria` becomes the description, and add an example to `convert_prd_to_json` help. Or, more discoverable, add a `### Description` subsection. **P2**.

### G9. Type-hint suggester rewrites human-loop criteria into `shell`
**Evidence** (from `--analyze-prd`):
```
Task: task-4 (UX polish — list output is human-readable)
  Criterion 1: "Manual: Run `node src/cli.js add "task one"` ..."
    Suggested:  [shell: node src/cli.js add "task one"]
```
Accepting this suggestion silently demotes a human-gated criterion to auto-passing.
**Cause**: `lib/criteria/suggestions.js` greps for verbs ("Run", "add") without checking for the `Manual:` prefix.
**Fix**: in the suggester, skip any criterion whose text matches `/^\s*manual\s*:/i`. **P1** because it actively misleads users into self-bypassing the human gate.

---

## MEDIUM — papercuts that degrade trust over time

### G10. `git push` fails silently against the user's repo
**Evidence**: every run shows `[WARN] Could not push <branch>:` with empty error message because `lib/git/index.js push`'s output isn't valid JSON when push fails.
**Repro**: HTTPS clone with credential-helper push works for normal git but the node wrapper in `lib/git/index.js push` swallows errors. Without push, the draft PR exists but never gets the latest commit.
**Fix**: have `lib/git/index.js push` emit `{ok:false, error:<git stderr>}` deterministically, never leak raw git stderr. Add a verbose-mode fallback that prints the full stderr.

### G11. Issue numbers don't reflect task ordering in GitHub URLs
**Evidence**: task-1=#1, task-2=#3, task-3=#5, task-4=#7 (PRs occupy even numbers). Cosmetic but confusing in cross-referencing.
**Fix**: nothing, this is GitHub's behavior. Just document it.

### G12. Project items show "Status: Todo" forever
**Evidence**: the Projects v2 board kept all items at default `Status: Todo` even after task-1 and task-2 passed.
**Cause** (likely): `sync_project_item` ran but its result wasn't observable in the log; combined with G1 it's plausible it never ran for the passed branch. Worth a focused test.
**Fix**: add explicit verbose log lines for each project field write so we can see them succeed/fail.

### G13. Iteration prompt to Claude omits manual criteria semantics
**Evidence**: the prompt for task-3 included:
```
3. Manual: Start the server with `npm start` … — (manual review, not automatically verified)
```
The annotation tells Claude not to worry about it, but this is contradictory: if it's not verified, why list it? Claude reasonably outputs "DONE" for any work and Ralph passes the task regardless.
**Fix (couples with G3)**: prompt should say something like "Manual criteria require human approval after this turn. Implement what you can, then say DONE." And then Ralph must actually wait for that approval (G3).

### G14. `--analyze-prd` tells Claude about the PRD then re-renders local stats first
**Evidence**: cosmetic — the stats block (Executable Coverage, deps) renders before the Claude analysis, which is fine, but the order is reversed in the help text.
**Fix**: trivial doc fix.

---

## LOW — cosmetic / minor

### L1. `progress.txt` shows "MCP: off" even when `--mcp` not passed (no-op state — fine but noisy).
### L2. Per-iteration verbose includes the full prompt every time (large repeated banners). Consider truncating verification list after the first iteration on a task.
### L3. No timestamp on the "[VERBOSE] Calling Claude API…" line; metadata block has duration but not start time.

---

## Recommended fix plan (priority order)

| # | Gap | Priority | Effort | Impact |
|---|-----|----------|--------|--------|
| G1 | Silent exit after each iteration | P0 | M | Unblocks the entire tool |
| G2 | JSON-truncation bug in state mutations | P0 | S | Prevents data loss |
| G3 | Manual criterion has no human gate | P0 | M-L | Core promise of the tool |
| G6 | Backslash not escaped in MD→JSON | P1 | S | Common regex use case |
| G7 | Blank line ends criteria parsing | P1 | S | Standard markdown style |
| G9 | Suggester rewrites Manual into shell | P1 | XS | Actively misleads |
| G4 | Issue close silently fails | P1 | S (after G1) | Trust |
| G5 | PR never marked ready | P1 | XS (after G1) | Trust |
| G10 | Git push wrapper swallows errors | P1 | S | Diagnosability |
| G8 | Description has no markdown slot | P2 | XS | UX |
| G12 | Project field sync silent | P2 | S | Observability |
| G13 | Manual criterion prompt is contradictory | P2 | XS | Couples with G3 |

**Suggested first sprint**: G1 + G2 + G6 + G7 + G9 (the parser/state correctness fixes — small, well-contained, unblock everything else). Second sprint: G3 (the human-loop story) — this is design work, not just a fix.

**Test PRD to add**: this same `prd.md` as a fixture under `tests/fixtures/`. With G1 fixed, the whole 4-task run should complete in one invocation. Until G3 is designed, task-4 should remain a known caveat in the test (or be skipped).
