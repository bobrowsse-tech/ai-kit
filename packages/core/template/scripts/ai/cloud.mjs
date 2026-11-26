// Read-only classifier for cloud and infrastructure CLIs (aws, az, gcloud, kubectl, helm, terraform/tofu, pulumi, gh).
// Used by hook.mjs (guard) and workspace.mjs. Zero dependencies.
//
//   classify(tokens) -> null                         not a cloud CLI
//                    -> { tool, kind, why }          kind: 'read' | 'mutate' | 'secret'
//
// 'read'    inspection that changes nothing and does not print secret values.
// 'mutate'  anything that creates, changes, deletes, deploys, logs in, or that we cannot prove is read-only.
// 'secret'  prints credential or secret values (secret managers, access tokens, kubernetes secrets, state dumps).
// Unknown verbs are 'mutate': the policy fails closed. This is a guard rail, not a sandbox.

const CLI = new Set(['aws', 'az', 'gcloud', 'kubectl', 'helm', 'terraform', 'tofu', 'pulumi', 'gh']);
const WRAPPERS = new Set(['env', 'time', 'command', 'nohup', 'nice', 'exec']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

/** Global flags that take a separate value (so the value is not mistaken for a sub-command). */
const VALUE_FLAGS = new Set([
  '--profile', '--region', '--output', '--query', '--endpoint-url', '--ca-bundle', '--color', '--cli-read-timeout', '--cli-connect-timeout', // aws
  '--subscription', '-o', '-s', '--only-show-errors-ignore', // az
  '--project', '--account', '--configuration', '--format', '--impersonate-service-account', // gcloud
  '--context', '--namespace', '-n', '--kubeconfig', '--cluster', '--user', '--server', // kubectl / helm
  '-chdir', '--kube-context', // helm / terraform
]);

const basename = (s) => String(s).replace(/\\/g, '/').split('/').pop().replace(/\.(exe|cmd|bat)$/i, '');

/** Drop leading VAR=value assignments and transparent wrappers (env, time, nohup...). */
function stripPrefix(t) {
  let i = 0;
  for (;;) {
    while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++;
    if (i < t.length && WRAPPERS.has(basename(t[i]))) { i++; continue; }
    break;
  }
  return t.slice(i);
}

/** Leading positional words (the command path), skipping flags and the values of known value flags. */
function commandWords(t) {
  const words = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.startsWith('-')) {
      if (words.length) break; // first flag after the command path ends it
      if (!x.includes('=') && VALUE_FLAGS.has(x)) i++;
      continue;
    }
    words.push(x);
  }
  return words;
}

const has = (t, ...flags) => t.some((x) => flags.some((f) => x === f || x.startsWith(`${f}=`)));
const READ_VERB = /^(describe|list|get|head|lookup|batch-get|search|query|scan|select|simulate|validate|verify|estimate|check|view|show|test|filter|tail|read|info|version|exists|status|history|whoami|diff|explain|top|logs|events|help)(-[a-z0-9-]+)?$/;

function aws(t, w) {
  if (!w.length || w[0] === 'help' || w[0] === 'version') return ['read'];
  const [svc, action = ''] = w;
  if (svc === 'configure') return ['list', 'list-profiles', 'get'].includes(action) ? (action === 'get' ? ['secret', 'aws configure get can print credentials'] : ['read']) : ['mutate', 'aws configure writes local credentials/config'];
  if (svc === 's3') return ['ls'].includes(action) ? ['read'] : ['mutate', `aws s3 ${action} copies, moves or deletes objects`];
  if (svc === 'sso' || svc === 'iam' && /^(create|delete|attach|detach|put|update|add|remove|upload|enable|disable|set)/.test(action)) return ['mutate', `aws ${svc} ${action}`];
  if (svc === 'secretsmanager' && action === 'get-secret-value') return ['secret', 'aws secretsmanager get-secret-value'];
  if (svc === 'ssm' && /^get-parameters?(-by-path)?$/.test(action) && has(t, '--with-decryption')) return ['secret', 'decrypted SSM parameter'];
  if (svc === 'kms' && /^(decrypt|generate-data-key)/.test(action)) return ['secret', 'KMS decrypt / data key'];
  if (svc === 'sts' && action === 'get-session-token') return ['secret', 'temporary credentials'];
  if (action === 'export-credentials') return ['secret', 'credentials'];
  if (svc === 'ecr' && action === 'get-login-password') return ['secret', 'registry password'];
  if (svc === 'lambda' && action === 'invoke') return ['mutate', 'aws lambda invoke runs code'];
  return READ_VERB.test(action) ? ['read'] : ['mutate', `aws ${svc} ${action}`];
}

function az(t, w) {
  if (!w.length) return ['read'];
  const verb = w[w.length - 1];
  const path = w.join(' ');
  if (/(^| )get-access-token$/.test(path) || /^(login|logout)$/.test(w[0]) || /account set$/.test(path)) return [/token/.test(path) ? 'secret' : 'mutate', path];
  if (/keyvault (secret|key|certificate) (show|download|get)/.test(path) || /storage account (keys list|show-connection-string)/.test(path) || /(list-keys|list-credentials|credential list|show-connection-string|connection-string)/.test(path)) return ['secret', path];
  if (verb === 'get-credentials') return ['mutate', 'az get-credentials writes credentials into the local kubeconfig'];
  if (/^(show|list|exists|query|version|tail|get|list-.+|get-.+|check-.+|show-.+)$/.test(verb)) return ['read'];
  return ['mutate', `az ${path}`];
}

const GCLOUD_MUTATING = /^(create|delete|update|deploy|add-.+|remove-.+|set-.+|patch|import|export|start|stop|restart|reset|resize|attach|detach|enable|disable|execute|submit|cancel|apply|replace|move|copy|rollback|promote|ssh|scp|login|activate|revoke|configure|undelete|migrate|upgrade|failover|restore|suspend|resume|run|call|invoke)$/;
const GCLOUD_READ = /^(describe|list|read|tail|info|version|get-value|get-iam-policy|list-.+|get-.+|show)$/;

function gcloud(t, w) {
  if (!w.length) return ['read'];
  const path = w.join(' ');
  if (/secrets versions access/.test(path) || /print-(access|identity)-token/.test(path) || /kms decrypt/.test(path)) return ['secret', path];
  if (/^auth (login|activate|revoke|configure)/.test(path) || /^config set/.test(path)) return ['mutate', path];
  if (/^(config list|auth list|config get-value)/.test(path)) return ['read'];
  // gcloud puts resource names after the verb as positionals, so find the first recognisable verb
  // after the product group instead of taking the last word.
  for (const word of w.length === 1 ? w : w.slice(1)) {
    if (word === 'get-credentials') return ['mutate', 'gcloud get-credentials writes credentials into the local kubeconfig'];
    if (GCLOUD_MUTATING.test(word)) return ['mutate', `gcloud ${path}`];
    if (GCLOUD_READ.test(word)) return ['read'];
  }
  return ['mutate', `gcloud ${path}`];
}

function kubectl(t, w) {
  if (!w.length) return ['read'];
  const [verb, sub = '', res = ''] = w;
  const resource = /^(secret|secrets)(\/|$)/.test(sub) || /^(secret|secrets)(\/|$)/.test(res);
  if (verb === 'get' && resource) return ['secret', 'kubernetes secret values'];
  if (verb === 'config') return /^(view|get-contexts|current-context|get-clusters|get-users)$/.test(sub) ? (sub === 'view' && has(t, '--raw') ? ['secret', 'kubeconfig credentials'] : ['read']) : ['mutate', `kubectl config ${sub} edits the local kubeconfig`];
  if (verb === 'auth') return /^(can-i|whoami)$/.test(sub) ? ['read'] : ['mutate', `kubectl auth ${sub}`];
  if (verb === 'rollout') return /^(status|history)$/.test(sub) ? ['read'] : ['mutate', `kubectl rollout ${sub}`];
  if (/^(get|describe|logs|top|explain|version|api-resources|api-versions|cluster-info|events|diff|wait)$/.test(verb)) return ['read'];
  return ['mutate', `kubectl ${verb}`];
}

function helm(t, w) {
  if (!w.length) return ['read'];
  const [verb, sub = ''] = w;
  if (verb === 'get' && /^(values|all|manifest)$/.test(sub)) return ['secret', 'helm values can contain secrets'];
  if (/^(list|ls|status|show|search|template|lint|version|history|get|env|verify)$/.test(verb)) return ['read'];
  if (verb === 'repo' && sub === 'list') return ['read'];
  return ['mutate', `helm ${verb}`];
}

function terraform(t, w) {
  if (!w.length) return ['read'];
  const [verb, sub = ''] = w;
  if (verb === 'state') return sub === 'list' ? ['read'] : sub === 'show' || sub === 'pull' ? ['secret', 'terraform state contains secret values'] : ['mutate', `terraform state ${sub}`];
  if (verb === 'output') return has(t, '-raw', '-json') ? ['secret', 'terraform output may be sensitive'] : ['read'];
  if (verb === 'workspace') return /^(list|show)$/.test(sub) ? ['read'] : ['mutate', `terraform workspace ${sub}`];
  if (verb === 'show') return ['mutate', 'terraform show can print state values; confirm it is a saved plan, not state'];
  if (/^(init|validate|plan|fmt|version|providers|graph|get|test)$/.test(verb)) return ['read'];
  return ['mutate', `terraform ${verb}`];
}

function pulumi(t, w) {
  if (!w.length) return ['read'];
  if (has(t, '--show-secrets')) return ['secret', 'pulumi --show-secrets'];
  const [verb, sub = ''] = w;
  if (/^(preview|whoami|version|about|logs)$/.test(verb)) return ['read'];
  if (verb === 'stack' && /^(ls|output|history|--show-urns)$/.test(sub)) return ['read'];
  return ['mutate', `pulumi ${verb}`];
}

function gh(t, w) {
  const [verb = '', sub = ''] = w;
  if (verb === 'api') {
    const m = t.findIndex((x) => x === '-X' || x === '--method');
    const method = m >= 0 ? String(t[m + 1] || '').toUpperCase() : (t.find((x) => /^--method=/.test(x)) || '').split('=')[1]?.toUpperCase();
    if ((method && method !== 'GET') || has(t, '-f', '-F', '--field', '--raw-field', '--input')) return ['mutate', 'gh api write request'];
    return ['read'];
  }
  if (verb === 'repo' && /^(delete|archive|rename)$/.test(sub)) return ['mutate', `gh repo ${sub}`];
  if ((verb === 'secret' || verb === 'variable') && /^(set|delete|remove)$/.test(sub)) return ['mutate', `gh ${verb} ${sub}`];
  return null; // other gh usage is ordinary development work
}

const HANDLERS = { aws, az, gcloud, kubectl, helm, terraform, tofu: terraform, pulumi, gh };

/** Classify one simple command (already split on && || ; | and newlines, and tokenized). */
export function classify(tokens, depth = 0) {
  const t = stripPrefix(tokens || []);
  if (!t.length) return null;
  const bin = basename(t[0]);
  if (SHELLS.has(bin) && depth < 2) { // bash -c "aws ..." : classify the inner command
    const i = t.indexOf('-c');
    if (i > 0 && typeof t[i + 1] === 'string') return classifyLine(t[i + 1], depth + 1);
    return null;
  }
  if (!CLI.has(bin)) return null;
  const rest = t.slice(1);
  const words = commandWords(rest);
  const out = HANDLERS[bin](rest, words);
  if (!out) return null;
  return { tool: bin, kind: out[0], why: out[1] || '' };
}

const tokenize = (c) => (c.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^["']|["']$/g, ''));

/** Classify a whole command line: the most severe result wins (secret > mutate > read). */
export function classifyLine(line, depth = 0) {
  const rank = { read: 1, mutate: 2, secret: 3 };
  let worst = null;
  for (const sub of String(line).split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean)) {
    const r = classify(tokenize(sub), depth);
    if (r && (!worst || rank[r.kind] > rank[worst.kind])) worst = r;
  }
  return worst;
}
