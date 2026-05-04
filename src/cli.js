#!/usr/bin/env node
const { loadTodos, saveTodos } = require('./storage');

const [, , cmd, ...rest] = process.argv;

if (cmd === 'add') {
  const text = rest.join(' ').trim();
  if (!text) {
    console.error('Usage: cli.js add <todo text>');
    process.exit(1);
  }
  const todos = loadTodos();
  const id = todos.length ? Math.max(...todos.map(t => t.id || 0)) + 1 : 1;
  todos.push({ id, text, done: false });
  saveTodos(todos);
  console.log(`Added #${id}: ${text}`);
} else if (cmd === 'list') {
  const todos = loadTodos();
  if (!todos.length) {
    console.log('No todos.');
  } else {
    const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
    const dim = useColor ? '\x1b[2m' : '';
    const cyan = useColor ? '\x1b[36m' : '';
    const green = useColor ? '\x1b[32m' : '';
    const reset = useColor ? '\x1b[0m' : '';
    const width = String(todos.length).length;
    todos.forEach((t, i) => {
      const n = String(i + 1).padStart(width, ' ');
      const box = t.done ? `${green}[x]${reset}` : '[ ]';
      const text = t.done ? `${dim}${t.text}${reset}` : t.text;
      console.log(`${cyan}${n}.${reset} ${box} ${text}`);
    });
  }
} else {
  console.error('Usage: cli.js <add|list> [args]');
  process.exit(1);
}
