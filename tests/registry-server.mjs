// Stand-in for the npm registry + MCP Registry, run as a SEPARATE process (test scripts use spawnSync,
// which would block an in-process server). Prints its port on the first line of stdout.
import http from 'node:http';

let bumped = false;
const day = 864e5;
const iso = (d) => new Date(Date.now() - d * day).toISOString();
const pack = (versions, latest) => ({
  'dist-tags': { latest },
  versions: Object.fromEntries(versions.map(([v, , dep]) => [v, dep ? { deprecated: 'old' } : {}])),
  time: Object.fromEntries(versions.map(([v, age]) => [v, iso(age)])),
  repository: { url: 'git+https://example.com/repo.git' },
});
const docs = () => ({
  'next-devtools-mcp': pack([['0.3.0', 90], ['0.4.0', 20], ['0.5.0-rc.1', 5], ['0.4.1', 1]], '0.4.1'), // fresh 0.4.1 held back, rc skipped
  '@playwright/mcp': pack([['0.0.30', 60], ['0.0.31', 30, true], ['0.0.32', 10], ...(bumped ? [['0.0.40', 9]] : [])], bumped ? '0.0.40' : '0.0.32'),
  'chrome-devtools-mcp': pack([['0.9.0', 40]], '0.9.0'),
  '@upstash/context7-mcp': pack([['1.0.0', 100], ['1.1.0', 15]], '1.1.0'),
});
const servers = [
  { server: { name: 'io.github.example/zod-helper-mcp', description: 'MCP server for zod schemas', version: '1.2.0', packages: [{ registryType: 'npm', identifier: '@example/zod-mcp', version: '1.2.0' }], repository: { url: 'https://github.com/example/zod-mcp' } }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } } },
  { server: { name: 'io.github.other/unrelated', description: 'something else', version: '1.0.0' }, _meta: {} },
];

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__bump') { bumped = true; return res.end('ok'); }
  if (u.pathname === '/v0.1/servers') {
    const q = (u.searchParams.get('search') || '').toLowerCase();
    return res.end(JSON.stringify({ servers: servers.filter((e) => JSON.stringify(e).toLowerCase().includes(q)) }));
  }
  const d = docs()[decodeURIComponent(u.pathname.slice(1))];
  if (!d) { res.statusCode = 404; return res.end('{}'); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(d));
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
