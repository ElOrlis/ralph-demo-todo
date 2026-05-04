const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(process.cwd(), 'todos.json');

function loadTodos(filePath = DEFAULT_PATH) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [];
}

function saveTodos(todos, filePath = DEFAULT_PATH) {
  fs.writeFileSync(filePath, JSON.stringify(todos, null, 2));
}

module.exports = { loadTodos, saveTodos };
