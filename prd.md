# Ralph Demo Todo — PRD

A tiny todo CLI used to stress-test ralph-loop. Tasks are intentionally small so each can complete in 1-2 Claude iterations, and they deliberately mix automated and human-in-the-loop verification to surface gaps in Ralph's manual-criterion handling.

**repository**: ElOrlis/ralph-demo-todo

## Task: Add file-backed JSON storage module

**Category**: backend
**Priority**: 1

### Acceptance Criteria

- File `src/storage.js` exists `[file-exists: ./src/storage.js]`
- Module loads without throwing `[shell: node -e "require('./src/storage')"]`
- Module exports `loadTodos` and `saveTodos` functions `[grep: "module\.exports.*loadTodos.*saveTodos|loadTodos.*saveTodos.*module\.exports" in ./src/storage.js]`

## Task: Add CLI with add and list commands

**Category**: cli
**Priority**: 2
**Depends On**: task-1

### Acceptance Criteria

- File `src/cli.js` exists `[file-exists: ./src/cli.js]`
- CLI requires the storage module `[grep: "require.*storage" in ./src/cli.js]`
- Adding then listing a todo round-trips the value `[shell: rm -f ./todos.json && node src/cli.js add "buy milk" && node src/cli.js list | grep -q "buy milk"]`

## Task: Add HTTP server exposing GET /todos

**Category**: backend
**Priority**: 3
**Depends On**: task-1

### Acceptance Criteria

- File `src/server.js` exists `[file-exists: ./src/server.js]`
- Server module loads without starting a listener on require `[shell: node -e "const m=require('./src/server'); if (typeof m.createServer !== 'function') process.exit(1)"]`
- Manual: Start the server with `npm start`, hit `http://localhost:3000/todos` in a browser, and confirm the response is a JSON array reflecting whatever is in `todos.json`. This criterion exists deliberately to test Ralph's human-in-the-loop verification path.

## Task: UX polish — list output is human-readable

**Category**: ux
**Priority**: 4
**Depends On**: task-2

### Acceptance Criteria

- Manual: Run `node src/cli.js add "task one"` and `node src/cli.js add "task two"`, then `node src/cli.js list`. Confirm the output is readable (numbered, one per line, no raw JSON dump). This task has no automated criteria — it should require human approval before closing.
- Manual: Confirm the list output uses ANSI color or some visual distinction between the index and the text. Subjective, on purpose.
