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
    for (const t of todos) {
      console.log(`${t.done ? '[x]' : '[ ]'} ${t.id}. ${t.text}`);
    }
  }
} else {
  console.error('Usage: cli.js <add|list> [args]');
  process.exit(1);
}
