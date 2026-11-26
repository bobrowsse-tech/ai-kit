// Multi-repo workspace: cloud classifier, workspace.mjs commands, guard access levels, installer wiring.
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CORE, ai, exists, install, put, read, sh, tmp } from './helpers.mjs';

const { classifyLine } = await import(pathToFileURL(path.join(CORE, 'template/scripts/ai/cloud.mjs')).href);

describe('cloud classifier', () => {
  const table = [
    ['aws ec2 describe-instances --region eu-north-1', 'read'],
    ['AWS_PROFILE=dev aws s3 ls s3://bucket', 'read'],
    ['aws --profile p logs tail /aws/lambda/x --since 1h', 'read'],
    ['aws sts get-caller-identity', 'read'],
    ['aws s3 rm s3://b/x --recursive', 'mutate'],
    ['aws s3 cp s3://b/x .', 'mutate'],
    ['aws lambda invoke --function-name f out.json', 'mutate'],
    ['aws ec2 terminate-instances --instance-ids i-1', 'mutate'],
    ['aws secretsmanager get-secret-value --secret-id x', 'secret'],
    ['aws ssm get-parameter --name n --with-decryption', 'secret'],
    ['aws ssm get-parameter --name n', 'read'],
    ['az vm list -g rg -o json', 'read'],
    ['az account show', 'read'],
    ['az account get-access-token', 'secret'],
    ['az keyvault secret show --name x --vault-name v', 'secret'],
    ['az keyvault key show --name k --vault-name v', 'secret'],
    ['az keyvault secret list --vault-name v', 'read'],
    ['az keyvault key list --vault-name v', 'read'],
    ['az group list -o table', 'read'],
    ['az storage account keys list -g rg -n st', 'secret'],
    ['az storage account show-connection-string -g rg -n st', 'secret'],
    ['az storage account keys renew -g rg -n st', 'secret'],
    ['az redis list-keys -g rg -n cache', 'secret'],
    ['az cognitiveservices account keys list -g rg -n ai', 'secret'],
    ['az cognitiveservices account keys regenerate -g rg -n ai --key-name Key1', 'secret'],
    ['az maps account keys list -g rg -n m', 'secret'],
    ['az signalr key list -g rg -n s', 'secret'],
    ['az search admin-key show -g rg --service-name s', 'secret'],
    ['az search query-key list -g rg --service-name s', 'secret'],
    ['az webapp deployment list-publishing-credentials -g rg -n app', 'secret'],
    ['az communication list-key -g rg -n c', 'secret'],
    ['az cosmosdb keys list -g rg -n db', 'secret'],
    ['az servicebus namespace authorization-rule keys list -g rg --namespace-name ns --name rule', 'secret'],
    ['az eventhubs namespace authorization-rule keys list -g rg --namespace-name ns --name rule', 'secret'],
    ['az webapp deployment list-publishing-profiles -g rg -n app', 'secret'],
    ['az search admin-key renew -g rg --service-name s --key-kind primary', 'secret'],
    ['az signalr key renew -g rg -n s --key-type primary', 'secret'],
    ['az redis regenerate-keys -g rg -n cache', 'secret'],
    ['az eventgrid topic key list -g rg -n t', 'secret'],
    ['az eventgrid domain key list -g rg -n d', 'secret'],
    ['az eventgrid topic key regenerate -g rg -n t --key-name key1', 'secret'],
    ['az webpubsub key show -g rg -n h', 'secret'],
    ['az webpubsub key regenerate -g rg -n h --key-name primary', 'secret'],
    ['az monitor log-analytics workspace get-shared-keys -g rg -n w', 'secret'],
    ['az datafactory integration-runtime list-auth-key -g rg --factory-name f --integration-runtime-name r', 'secret'],
    ['az acr credential show -n r', 'secret'],
    ['az acr credential renew -n r', 'secret'],
    ['az network vpn-connection shared-key show -g rg -n c', 'secret'],
    ['az network vpn-connection shared-key reset -g rg -n c', 'secret'],
    ['az staticwebapp secrets list -n app', 'secret'],
    ['az communication regenerate-key -g rg -n c', 'secret'],
    ['az iot hub policy renew-key -g rg --hub-name h -n policy', 'secret'],
    ['az redisenterprise database regenerate-key -g rg --cluster-name c --database-name d', 'secret'],
    ['az sshkey show --name k -g rg', 'read'],
    ['az keyvault certificate list --vault-name v', 'read'],
    ['az containerapp function keys show -n app -g rg --function-name f --key-name k', 'secret'],
    ['az containerapp function keys set -n app -g rg --function-name f --key-name k --key-value v', 'secret'],
    ['az iot hub policy show --hub-name h -n p -g rg', 'secret'],
    ['az iot hub policy list --hub-name h -g rg', 'secret'],
    ['az iot dps policy show --dps-name d -n p -g rg', 'secret'],
    ['az iot dps policy list --dps-name d -g rg', 'secret'],
    ['az iot hub device-identity show --hub-name h -d dev', 'secret'],
    ['az iot hub device-identity list --hub-name h', 'secret'],
    ['az iot hub module-identity show --hub-name h -d dev -m mod', 'secret'],
    ['az iot hub module-identity list --hub-name h -d dev', 'secret'],
    ['az monitor app-insights api-key create --app a -g rg --api-key k', 'secret'],
    ['az monitor app-insights api-key show --app a -g rg', 'read'],
    ['az containerapp secret list -n app -g rg', 'read'],
    ['az containerapp secret list -n app -g rg --show-values', 'secret'],
    ['az iot dps enrollment show --dps-name d -g rg --enrollment-id e', 'read'],
    ['az iot dps enrollment show --dps-name d -g rg --enrollment-id e --show-keys', 'secret'],
    ['az iot dps enrollment list --dps-name d -g rg --keys', 'secret'],
    ['az iot dps enrollment-group show --dps-name d -g rg --enrollment-id g --show-keys', 'secret'],
    ['az iot dps enrollment-group list --dps-name d -g rg --show-keys', 'secret'],
    ['az iot dps enrollment create --dps-name d -g rg --enrollment-id e', 'secret'],
    ['az iot dps enrollment-group compute-device-key --dps-name d -g rg --enrollment-id g', 'secret'],
    ['az iot central device show-credentials -n app -d dev', 'secret'],
    ['az iot central device compute-device-key -n app -d dev', 'secret'],
    ['az aks get-credentials -g r -n c', 'mutate'],
    ['az group delete -n rg', 'mutate'],
    ['gcloud run services describe svc --region eu', 'read'],
    ['gcloud compute instances list', 'read'],
    ['gcloud compute instances delete vm1', 'mutate'],
    ['gcloud run deploy svc --image x', 'mutate'],
    ['gcloud secrets versions access latest --secret=x', 'secret'],
    ['kubectl get pods -n prod', 'read'],
    ['kubectl logs deploy/api --tail 50', 'read'],
    ['kubectl get secret db -o yaml', 'secret'],
    ['kubectl delete pod x', 'mutate'],
    ['kubectl exec -it p -- sh', 'mutate'],
    ['kubectl config current-context', 'read'],
    ['kubectl rollout status deploy/api', 'read'],
    ['kubectl rollout restart deploy/api', 'mutate'],
    ['terraform plan', 'read'],
    ['terraform validate', 'read'],
    ['terraform state list', 'read'],
    ['terraform apply -auto-approve', 'mutate'],
    ['tofu destroy', 'mutate'],
    ['terraform output -json', 'secret'],
    ['terraform state pull', 'secret'],
    ['helm list -A', 'read'],
    ['helm upgrade x y', 'mutate'],
    ['pulumi preview', 'read'],
    ['pulumi up', 'mutate'],
    ['gh api repos/o/r/issues', 'read'],
    ['gh api -X POST repos/o/r/issues', 'mutate'],
    ['gh api repos/o/r -f name=x', 'mutate'],
    ['bash -c "aws ec2 terminate-instances --instance-ids i-1"', 'mutate'],
    ['cd infra && terraform plan && terraform apply', 'mutate'],
    ['/usr/local/bin/aws s3 rm s3://b', 'mutate'],
  ];
  for (const [cmd, kind] of table) it(`${cmd} -> ${kind}`, () => assert.equal(classifyLine(cmd)?.kind, kind));
  for (const cmd of ['npm test', 'git push origin main', 'ls -la', 'gh pr list', 'awk "{print}" file']) {
    it(`ignores ${cmd}`, () => assert.equal(classifyLine(cmd), null));
  }
});

// Three repos next to each other: Angular web, ASP.NET api, Terraform infra.
let parent; let web; let api; let infra;
const w = (dir, ...args) => ai(dir, 'workspace.mjs', args);
const j = (dir, ...args) => JSON.parse(w(dir, ...args).out);

before(() => {
  parent = tmp('aikit-ws-');
  web = path.join(parent, 'web'); api = path.join(parent, 'api'); infra = path.join(parent, 'infra');
  put(web, {
    'package.json': { name: 'web', dependencies: { '@angular/core': '19.0.0' } },
    'src/app/orders.service.ts': `import { HttpClient } from '@angular/common/http';
export class OrdersService {
  constructor(private http: HttpClient) {}
  list() { return this.http.get<Order[]>(\`\${environment.apiUrl}/api/orders\`); }
  get(id: string) { return this.http.get<Order>(\`\${environment.apiUrl}/api/orders/\${id}\`); }
  cancel(id: string) { return this.http.post(\`\${environment.apiUrl}/api/orders/\${id}/cancel\`, {}); }
  export() { return this.http.get(this.base + '/api/orders/export'); }
  update(id: string, o: Order) { return this.http.put(\`/api/orders/\${id}\`, o); }
  customer(id: string) { return this.http.get('/api/customers/' + id); }
  config() { return this.http.get('/assets/config.json'); }
}
`,
  });
  put(api, {
    'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
    'Controllers/OrdersController.cs': `[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet] public IActionResult List() => Ok();
    [HttpGet("{id}")] public IActionResult Get(string id) => Ok();
    [HttpPatch("{id}")] public IActionResult Update(string id) => Ok();
    [HttpPost("{id}/refund")] public IActionResult Refund(string id) => Ok();
    [HttpGet("export")] public IActionResult Export() => Ok();
}
`,
    'Program.cs': `app.MapGet("/health", () => "ok");
var g = app.MapGroup("/api/invoices");
g.MapGet("/{id}", (string id) => id);
`,
    'Secrets.cs': 'var password = "hunter2hunter2hunter2"; // refund db\n',
    '.env': 'REFUND_KEY=abc\n',
  });
  put(infra, { 'main.tf': 'resource "aws_sqs_queue" "refunds" { name = "refunds" }\n' });
  for (const d of [web, api]) { sh(d, 'git init -q'); const r = install(d); assert.equal(r.code, 0, r.all); }
  sh(infra, 'git init -q');
});

describe('workspace.mjs: setup', () => {
  it('without a manifest: check is a no-op and other commands explain how to start', () => {
    assert.equal(w(web, 'check').code, 0);
    const r = w(web, 'status');
    assert.equal(r.code, 1);
    assert.match(r.err, /workspace\.mjs init/);
  });
  it('install ships the script, the classifier and four skills, but no manifest', () => {
    for (const f of ['scripts/ai/workspace.mjs', 'scripts/ai/cloud.mjs', '.claude/skills/cross-repo-context/SKILL.md', '.claude/skills/cross-repo-investigate/SKILL.md', '.claude/skills/cross-repo-change/SKILL.md', '.claude/skills/cloud-inspect/SKILL.md']) assert.ok(exists(web, f), f);
    assert.ok(!exists(web, '.ai/workspace.json'));
    assert.match(read(web, 'AGENTS.md'), /## 15\. Multi-repo workspace/);
  });
  it('init creates the manifest, docs folder and gitignore entry; running it again changes nothing', () => {
    const r = w(web, 'init');
    assert.equal(r.code, 0, r.all);
    const m = JSON.parse(read(web, '.ai/workspace.json'));
    assert.equal(m.repos.web.path, '.');
    assert.equal(m.repos.web.role, 'frontend');
    assert.ok(exists(web, 'docs/cross-repo/README.md') && exists(web, 'docs/cross-repo/inbox/.gitkeep'));
    assert.match(read(web, '.gitignore'), /\.ai\/workspace\.local\.json/);
    const before = read(web, '.ai/workspace.json');
    assert.match(w(web, 'init').out, /exists/);
    assert.equal(read(web, '.ai/workspace.json'), before);
  });
  it('scan lists sibling repos and writes nothing', () => {
    const r = w(web, 'scan');
    assert.match(r.out, /api\s+backend/);
    assert.doesNotMatch(read(web, '.ai/workspace.json'), /"api"/);
  });
  it('add records a relative path, guesses the role, and rejects bad access', () => {
    assert.equal(w(web, 'add', '../api', '--access', 'inbox', '--summary', 'orders api').code, 0);
    assert.equal(w(web, 'add', '../infra').code, 0);
    const m = JSON.parse(read(web, '.ai/workspace.json'));
    assert.deepEqual([m.repos.api.path, m.repos.api.role, m.repos.api.access], ['../api', 'backend', 'inbox']);
    assert.deepEqual([m.repos.infra.role, m.repos.infra.access], ['infra', 'read']);
    assert.notEqual(w(web, 'add', '../api', '--access', 'root').code, 0);
    assert.notEqual(w(web, 'add', '../nope').code, 0);
  });
  it('never writes remote credentials into the committed manifest', () => {
    sh(api, 'git remote add origin https://user:tok3n@example.com/o/api.git');
    assert.equal(w(web, 'add', '../api', '--access', 'inbox', '--summary', 'orders api').code, 0);
    assert.doesNotMatch(read(web, '.ai/workspace.json'), /tok3n|user:/);
    assert.match(read(web, '.ai/workspace.json'), /https:\/\/example\.com\/o\/api\.git/);
  });
});

describe('workspace.mjs: reading sister repos', () => {
  it('status --json reports repos, state, and a warning that api cannot see web yet', () => {
    const s = j(web, 'status', '--json');
    assert.deepEqual(s.repos.map((r) => r.id), ['web', 'api', 'infra']);
    assert.ok(s.repos.find((r) => r.id === 'api').found);
    assert.ok(s.warnings.some((x) => /api: no \.ai\/workspace\.json/.test(x)));
    assert.equal(w(api, 'init').code, 0);
    assert.equal(w(api, 'add', '../web', '--access', 'inbox').code, 0);
    assert.ok(!j(web, 'status', '--json').warnings.some((x) => /does not list this repo|no \.ai\/workspace\.json/.test(x) && x.startsWith('api')));
  });
  it('status flags a missing sister repo and suggests how to clone it', () => {
    const raw = JSON.parse(read(web, '.ai/workspace.json'));
    raw.repos.ghost = { role: 'backend', path: '../ghost', remote: 'https://example.com/o/ghost.git', access: 'read' };
    fs.writeFileSync(path.join(web, '.ai/workspace.json'), JSON.stringify(raw));
    assert.match(w(web, 'status').out, /ghost: not found at \.\.\/ghost.*git clone https:\/\/example\.com\/o\/ghost\.git/);
    delete raw.repos.ghost;
    fs.writeFileSync(path.join(web, '.ai/workspace.json'), JSON.stringify(raw));
  });
  it('brief is compact, shows the HTTP surface, and reports placeholder docs as a gap', () => {
    const r = w(web, 'brief', 'api');
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.split('\n').length < 60);
    assert.match(r.out, /provides POST \/api\/orders\/\{\}\/refund/);
    assert.match(r.out, /Still template placeholders in api/);
    assert.doesNotMatch(r.out, /TODO/);
  });
  it('search finds text in C#, skips secret files, hides credential-looking lines', () => {
    const r = w(web, 'search', 'api', 'refund');
    assert.match(r.out, /api:Controllers\/OrdersController\.cs/);
    assert.doesNotMatch(r.out, /REFUND_KEY|\.env/);
    assert.doesNotMatch(r.out, /hunter2/);
    assert.match(r.out, /line hidden/);
    assert.match(w(web, 'search', 'all', 'refunds', 'queue').out + w(web, 'search', 'infra', 'refunds').out, /infra:main\.tf/);
  });
  it('contracts extracts ASP.NET controllers, minimal APIs and groups', () => {
    const c = j(web, 'contracts', 'api', '--json')[0];
    const set = new Set(c.provides.map((p) => `${p.method} ${p.path}`));
    for (const e of ['GET /api/orders', 'GET /api/orders/{}', 'PATCH /api/orders/{}', 'POST /api/orders/{}/refund', 'GET /api/orders/export', 'GET /health', 'GET /api/invoices/{}']) assert.ok(set.has(e), e);
  });
  it('gaps finds the missing endpoint, the method mismatch and the unused endpoints', () => {
    const g = j(web, 'gaps', '--json');
    assert.ok(g.gaps.some((x) => x.call.method === 'POST' && x.call.path === '/api/orders/{}/cancel'));
    assert.deepEqual(g.gaps.find((x) => x.call.path === '/api/orders/{}/cancel').nearest[0].path, '/api/orders/{}/refund');
    assert.ok(g.gaps.some((x) => x.call.path === '/api/customers' && x.nearest.length === 0));
    assert.equal(g.mismatches.length, 1);
    assert.equal(g.mismatches[0].call.method, 'PUT');
    assert.ok(g.unused.some((u) => u.path === '/health'));
    assert.ok(g.matched >= 3);
    assert.ok(!g.gaps.some((x) => /assets/.test(x.call.path)), 'static assets are not API calls');
  });
  it('gaps --report writes a prefilled report', () => {
    const r = w(web, 'gaps', '--report');
    assert.match(r.out, /Wrote docs\/cross-repo\/.*contract-gap-scan/);
    const f = fs.readdirSync(path.join(web, 'docs/cross-repo')).find((x) => /contract-gap-scan/.test(x));
    assert.match(read(web, `docs/cross-repo/${f}`), /NO PROVIDER FOUND/);
  });
});

describe('workspace.mjs: contract extractors', () => {
  it('reads OpenAPI JSON/YAML, Express, Nest, Next route handlers, FastAPI and Flask', () => {
    const out = tmp('aikit-hub-');
    const svc = path.join(out, 'svc');
    const me = path.join(out, 'me');
    put(svc, {
      'package.json': { name: 'svc', dependencies: { express: '4.0.0' } },
      'openapi.json': { openapi: '3.0.0', servers: [{ url: 'https://h.example/v2' }], paths: { '/pets/{id}': { get: {}, delete: {} } } },
      'spec/swagger.yaml': 'openapi: 3.0.0\nservers:\n  - url: /v3\npaths:\n  /owners:\n    get:\n      x: 1\n    post:\n      x: 1\n',
      'src/server.js': "const express = require('express');\nconst router = express.Router();\nrouter.get('/users/:id', h);\nrouter.post('/users', h);\n",
      'src/orders.controller.ts': "@Controller('orders')\nexport class C {\n  @Get(':id') one() {}\n  @Post() make() {}\n}\n",
      'app/api/items/[id]/route.ts': 'export async function GET() {}\nexport async function DELETE() {}\n',
      'api/main.py': "router = APIRouter(prefix='/v1')\n@router.get('/things/{tid}')\ndef x(): pass\n@app.route('/old', methods=['POST', 'PUT'])\ndef y(): pass\n",
      'docs/schema.md': '- `GET /api/documented-only`\n',
    });
    put(me, { 'package.json': { name: 'me' } });
    for (const d of [svc, me]) { sh(d, 'git init -q'); assert.equal(install(d).code, 0); }
    assert.equal(w(me, 'init').code, 0);
    assert.equal(w(me, 'add', '../svc').code, 0);
    const c = j(me, 'contracts', 'svc', '--json')[0];
    const set = new Set(c.provides.map((p) => `${p.method} ${p.path}`));
    for (const e of ['GET /v2/pets/{}', 'DELETE /v2/pets/{}', 'GET /v3/owners', 'POST /v3/owners', 'GET /users/{}', 'POST /users', 'GET /orders/{}', 'POST /orders', 'GET /api/items/{}', 'DELETE /api/items/{}', 'GET /v1/things/{}', 'POST /old', 'PUT /old', 'GET /api/documented-only']) assert.ok(set.has(e), `${e} in ${[...set].join(', ')}`);
  });
});

describe('workspace.mjs: reports, handoff and inbox', () => {
  it('report new creates a dated report from the template', () => {
    const r = w(web, 'report', 'new', 'Cancel order flow', '--type', 'feasibility');
    assert.equal(r.code, 0, r.all);
    const f = fs.readdirSync(path.join(web, 'docs/cross-repo')).find((x) => /cancel-order-flow/.test(x));
    const t = read(web, `docs/cross-repo/${f}`);
    assert.match(t, /^---\ntype: feasibility/);
    assert.match(t, /## Handoff/);
    assert.notEqual(w(web, 'report', 'new', 'x', '--type', 'bogus').code, 0);
  });
  it('handoff writes into the inbox of a repo that allows it, and only there', () => {
    const f = fs.readdirSync(path.join(web, 'docs/cross-repo')).find((x) => /cancel-order-flow/.test(x));
    fs.appendFileSync(path.join(web, `docs/cross-repo/${f}`), '\n## Handoff to api\n### Requested change\nAdd POST /api/orders/{id}/cancel.\n');
    const r = w(web, 'handoff', '--to', 'api', '--title', 'Add cancel-order endpoint', '--from-report', `docs/cross-repo/${f}`);
    assert.equal(r.code, 0, r.all);
    const inbox = fs.readdirSync(path.join(api, 'docs/cross-repo/inbox')).filter((x) => x.endsWith('.md'));
    assert.equal(inbox.length, 1);
    const t = read(api, `docs/cross-repo/inbox/${inbox[0]}`);
    assert.match(t, /from: web\nto: api/);
    assert.match(t, /status: open/);
    assert.match(t, /Add POST \/api\/orders\/\{id\}\/cancel/);
    assert.match(w(api, 'inbox').out, /Add cancel-order endpoint/);
    assert.match(w(api, 'status').out, /Open requests for this repo/);
    assert.match(w(web, 'inbox', 'api').out, /from web/);
    assert.equal(w(web, 'handoff', '--to', 'api', '--title', 'Add cancel-order endpoint', '--from-report', `docs/cross-repo/${f}`).code, 1, 'never overwrites');
  });
  it('handoff to a read-only repo writes nothing and exits 3 with the text to hand over', () => {
    const r = w(web, 'handoff', '--to', 'infra', '--title', 'Need a queue');
    assert.equal(r.code, 3);
    assert.match(r.out, /nothing was written/);
    assert.ok(!exists(infra, 'docs/cross-repo'));
  });
  it('handoff refuses secret files and files outside the repo as body', () => {
    put(web, { '.env': 'A=1\n' });
    assert.notEqual(w(web, 'handoff', '--to', 'api', '--title', 't1', '--body-file', '.env').code, 0);
    assert.notEqual(w(web, 'handoff', '--to', 'api', '--title', 't2', '--body-file', '../api/Secrets.cs').code, 0);
    assert.notEqual(w(web, 'handoff', '--to', 'api', '--title', 't3', '--from-report', 'docs/cross-repo/README.md').code, 0, 'report without a Handoff section');
  });
  it('inbox close moves the item to done/', () => {
    const f = fs.readdirSync(path.join(api, 'docs/cross-repo/inbox')).find((x) => x.endsWith('.md'));
    assert.equal(w(api, 'inbox', 'close', f, '--note', 'done in api#12').code, 0);
    assert.ok(exists(api, `docs/cross-repo/inbox/done/${f}`));
    assert.match(read(api, `docs/cross-repo/inbox/done/${f}`), /status: done[\s\S]*api#12/);
    assert.match(w(api, 'inbox').out, /No open requests/);
  });
});

describe('workspace.mjs: launch helpers and manifest validation', () => {
  it('link writes relative additionalDirectories to the personal settings file only', () => {
    assert.equal(w(web, 'link').code, 0);
    const s = JSON.parse(read(web, '.claude/settings.local.json'));
    assert.deepEqual(s.permissions.additionalDirectories.sort(), ['../api', '../infra']);
    assert.doesNotMatch(read(web, '.claude/settings.json'), /additionalDirectories/);
  });
  it('hub writes a marked block in the parent CLAUDE.md (idempotent) and a .code-workspace once', () => {
    assert.equal(w(web, 'hub').code, 0);
    assert.equal(w(web, 'hub').code, 0);
    const md = fs.readFileSync(path.join(parent, 'CLAUDE.md'), 'utf8');
    assert.equal((md.match(/BEGIN ai-kit workspace/g) || []).length, 1);
    assert.match(md, /`api\/` - backend/);
    const cw = fs.readdirSync(parent).find((x) => x.endsWith('.code-workspace'));
    assert.ok(cw);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(parent, cw), 'utf8')).folders.map((f) => f.name).sort(), ['api', 'infra', 'web']);
  });
  it('check accepts the manifest and rejects absolute paths, credentials, bad access and bad ids', () => {
    assert.equal(w(web, 'check').code, 0);
    const good = read(web, '.ai/workspace.json');
    const bad = { version: 1, repos: { 'Bad_Id': { path: '/abs/api' }, ok: { path: '../ok', access: 'root', remote: 'https://u:p@h/x.git' }, a: { path: '.' }, b: { path: '.' } } };
    fs.writeFileSync(path.join(web, '.ai/workspace.json'), JSON.stringify(bad));
    const r = w(web, 'check');
    assert.equal(r.code, 1);
    for (const re of [/Bad_Id/, /must be relative/, /access must be one of/, /credentials/, /only one repo/]) assert.match(r.err, re);
    fs.writeFileSync(path.join(web, '.ai/workspace.json'), good);
  });
});

describe('guard: sister-repo access levels', () => {
  const pre = (dir, input) => ai(dir, 'hook.mjs', ['pre-tool'], { CLAUDE_PROJECT_DIR: dir }, JSON.stringify(input));
  const edit = (dir, file_path, tool = 'Edit') => pre(dir, { tool_name: tool, tool_input: { file_path, new_string: 'x', content: 'x' } });

  it('denies edits in an inbox repo outside the inbox, allows the inbox, allows own files', () => {
    const r = edit(web, '../api/Controllers/OrdersController.cs');
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /api is a sister repo with access "inbox"/);
    assert.match(r.err, /workspace\.mjs handoff --to api/);
    assert.equal(edit(web, '../api/docs/cross-repo/inbox/x.md', 'Write').code, 0);
    assert.equal(edit(web, 'src/app/orders.service.ts').code, 0);
  });
  it('denies edits in a read-only repo, including absolute paths and ../ tricks', () => {
    for (const p of [path.join(infra, 'main.tf'), '../infra/main.tf', '../api/../infra/main.tf', 'src/../../infra/main.tf']) assert.equal(edit(web, p, 'Write').code, 2, p);
  });
  it('allows reads of sister repos but still blocks their secret files', () => {
    assert.equal(pre(web, { tool_name: 'Read', tool_input: { file_path: '../api/Program.cs' } }).code, 0);
    assert.equal(pre(web, { tool_name: 'Read', tool_input: { file_path: '../api/.env' } }).code, 2);
  });
  it('a per-developer override can grant write; the committed manifest stays strict', () => {
    put(web, { '.ai/workspace.local.json': { repos: { api: { access: 'write' } } } });
    assert.equal(edit(web, '../api/Controllers/OrdersController.cs').code, 0);
    assert.equal(edit(web, '../infra/main.tf').code, 2);
    fs.rmSync(path.join(web, '.ai/workspace.local.json'));
    assert.equal(edit(web, '../api/Controllers/OrdersController.cs').code, 2);
  });
  it('asks before the manifest or the classifier is edited', () => {
    for (const f of ['.ai/workspace.json', 'scripts/ai/cloud.mjs']) {
      const r = edit(web, f);
      assert.equal(r.code, 0);
      assert.match(r.out, /"permissionDecision":"ask"/, f);
    }
  });
  it('changes nothing for a project without a manifest', () => {
    assert.equal(edit(api2(), '../anything/file.txt').code, 0);
  });
  function api2() { const d = tmp('aikit-plain-'); put(d, { 'package.json': { name: 'p' } }); assert.equal(install(d).code, 0); return d; }
});

describe('guard: cloud policy', () => {
  const bashIn = (dir, command, mode = 'pre-tool', env = {}) => ai(dir, 'hook.mjs', [mode], { CLAUDE_PROJECT_DIR: dir, ...env }, JSON.stringify(mode === 'cursor' ? { hook_event_name: 'beforeShellExecution', command } : { tool_name: 'Bash', tool_input: { command } }));
  const setCloud = (dir, v) => { const c = JSON.parse(read(dir, '.ai/config.json')); c.workspace = { cloud: v }; fs.writeFileSync(path.join(dir, '.ai/config.json'), JSON.stringify(c)); };

  it('reads pass silently; mutations ask; secret reads are denied', () => {
    const rd = bashIn(web, 'aws ec2 describe-instances --region eu-north-1');
    assert.equal(rd.code, 0); assert.equal(rd.out.trim(), '');
    const mut = bashIn(web, 'terraform apply -auto-approve');
    assert.equal(mut.code, 0); assert.match(mut.out, /"permissionDecision":"ask"/);
    const sec = bashIn(web, 'kubectl get secret db -o yaml');
    assert.equal(sec.code, 2); assert.match(sec.err, /secret values/);
    assert.equal(bashIn(web, 'cd ../infra && terraform plan').code, 0);
    assert.equal(bashIn(web, 'npm test').code, 0);
  });
  it('workspace.cloud = deny turns asks into blocks; off disables the policy', () => {
    setCloud(web, 'deny');
    assert.equal(bashIn(web, 'az group delete -n rg').code, 2);
    setCloud(web, 'off');
    const r = bashIn(web, 'az group delete -n rg');
    assert.equal(r.code, 0); assert.equal(r.out.trim(), '');
    assert.equal(bashIn(web, 'aws secretsmanager get-secret-value --secret-id x').code, 0);
    setCloud(web, 'ask');
  });
  it('existing guard rules still win and still block', () => {
    assert.equal(bashIn(web, 'git push origin main --force').code, 2);
    assert.equal(bashIn(web, 'cat .env').code, 2);
  });
  it('Cursor gets an ask permission for a mutating cloud command', () => {
    const r = bashIn(web, 'kubectl delete pod x', 'cursor');
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).permission, 'ask');
    assert.equal(JSON.parse(bashIn(web, 'kubectl get pods', 'cursor').out).permission, 'allow');
  });
});

describe('installer', () => {
  it('update refreshes the new owned files and keeps a modified skill as .kit-new', () => {
    const d = tmp('aikit-upd-');
    put(d, { 'package.json': { name: 'u' } });
    assert.equal(install(d).code, 0);
    fs.appendFileSync(path.join(d, '.claude/skills/cloud-inspect/SKILL.md'), '\nmy note\n');
    const r = install(d, ['--update']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.all, /cloud-inspect\/SKILL\.md.*kit-new|CONFLICTS/s);
    assert.ok(exists(d, '.claude/skills/cloud-inspect/SKILL.md.kit-new'));
    const settings = JSON.parse(read(d, '.claude/settings.json'));
    assert.ok(settings.permissions.allow.includes('Bash(node scripts/ai/workspace.mjs status*)'));
  });
});
