const http = require('http');
const { loadTodos } = require('./storage');

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/todos') {
      const todos = loadTodos();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(todos));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = { createServer };
