'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENDPOINTS = {
  IAM_TOKEN: 'https://iam.api.vngcloud.vn/accounts-api/v2/auth/token',
  AIP: 'https://aiplatform-hcm.api.vngcloud.vn',
  RUNTIME: 'https://agentbase.api.vngcloud.vn/runtime',
  CR: 'https://agentbase.api.vngcloud.vn/cr/api/v1',
};

function req(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent': 'urd-guardian-deploy/1.0' };
    let bodyData = null;
    if (opts.basicAuth) headers['Authorization'] = 'Basic ' + Buffer.from(opts.basicAuth).toString('base64');
    if (opts.bearer) headers['Authorization'] = 'Bearer ' + opts.bearer;
    if (opts.json) {
      headers['Content-Type'] = 'application/json';
      bodyData = JSON.stringify(opts.json);
    } else if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      bodyData = opts.form;
    }
    if (bodyData) headers['Content-Length'] = Buffer.byteLength(bodyData);
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_e) { json = data; }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    r.on('error', reject);
    if (bodyData) r.write(bodyData);
    r.end();
  });
}

function loadCreds() {
  const file = path.join(ROOT, '.greennode.json');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!c.client_id || !c.client_secret) throw new Error('Missing client_id/client_secret in .greennode.json');
  return c;
}

async function getToken() {
  const c = loadCreds();
  const r = await req('POST', ENDPOINTS.IAM_TOKEN, { basicAuth: `${c.client_id}:${c.client_secret}`, form: 'grant_type=client_credentials' });
  if (r.status !== 200 || !r.json || !r.json.access_token) throw new Error(`IAM token failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json.access_token;
}

async function canUsePoc(token) {
  const r = await req('GET', `${ENDPOINTS.AIP}/v1/runtime-billing/can-use-poc`, { bearer: token });
  const val = r.json && (r.json.canUseRuntimePoc !== undefined ? r.json.canUseRuntimePoc : (r.json.data && r.json.data.canUseRuntimePoc));
  return { status: r.status, canUseRuntimePoc: val, raw: r.json };
}

async function crRepo(token) {
  const r = await req('GET', `${ENDPOINTS.CR}/repository`, { bearer: token });
  return r.json;
}

async function crCredentials(token) {
  const r = await req('GET', `${ENDPOINTS.CR}/registry-credential`, { bearer: token });
  return r.json;
}

async function flavors(token) {
  const r = await req('GET', `${ENDPOINTS.RUNTIME}/flavors`, { bearer: token });
  return r.json;
}

async function listRuntimes(token) {
  const r = await req('GET', `${ENDPOINTS.RUNTIME}/agent-runtimes?page=1&size=100`, { bearer: token });
  return r.json;
}

async function getRuntime(token, id) {
  const r = await req('GET', `${ENDPOINTS.RUNTIME}/agent-runtimes/${id}`, { bearer: token });
  return r.json;
}

async function listEndpoints(token, id) {
  const r = await req('GET', `${ENDPOINTS.RUNTIME}/agent-runtimes/${id}/endpoints?page=1&size=100`, { bearer: token });
  return r.json;
}

async function createRuntime(token, body) {
  const r = await req('POST', `${ENDPOINTS.RUNTIME}/agent-runtimes`, { bearer: token, json: body });
  return { status: r.status, json: r.json };
}

function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

async function discover() {
  const token = await getToken();
  console.log('✓ IAM token obtained');
  const poc = await canUsePoc(token);
  console.log('POC eligibility:', JSON.stringify(poc.canUseRuntimePoc));
  const repo = await crRepo(token);
  console.log('CR repo:', JSON.stringify({ name: repo.name, registryUrl: repo.registryUrl, quotaLimit: repo.quotaLimit, quotaUsed: repo.quotaUsed, imageCount: repo.imageCount }));
  const fl = await flavors(token);
  const list = (fl && (fl.listData || fl.data)) || [];
  const eligible = list.filter((f) => (f.supportedResourceTypes || []).includes('agent-runtime'));
  console.log('Flavors (agent-runtime, PUBLIC):');
  for (const f of eligible) console.log(`  - ${f.id || f.flavorId}  cpu=${f.cpu || f.vcpu} ram=${f.ram || f.memory}  types=${(f.supportedResourceTypes || []).join(',')}`);
  const rt = await listRuntimes(token);
  const runtimes = (rt && (rt.listData || rt.data)) || [];
  console.log(`Existing runtimes: ${runtimes.length}`);
  for (const r of runtimes) console.log(`  - ${r.name} (id=${r.id}, status=${r.status})`);
  return { token, poc, repo, flavors: eligible, runtimes };
}

async function deploy(opts) {
  const { runtimeName, flavorId, poc, tag, envFile } = opts;
  const token = await getToken();
  const repo = await crRepo(token);
  const cred = await crCredentials(token);
  const registryUrl = repo.registryUrl;
  const repoName = repo.name;
  const image = `${registryUrl}/${repoName}/${runtimeName}:${tag}`;
  console.log(`Image: ${image}`);

  console.log('→ docker login to registry...');
  execSync(`docker login ${registryUrl} -u ${cred.username} --password-stdin`, { input: cred.secret, stdio: ['pipe', 'ignore', 'inherit'] });

  console.log('→ docker build (linux/amd64)...');
  execSync(`docker build --platform linux/amd64 -t ${image} .`, { cwd: ROOT, stdio: 'inherit' });

  console.log('→ docker push...');
  execSync(`docker push ${image}`, { cwd: ROOT, stdio: 'inherit' });

  const envVars = envFile && fs.existsSync(path.join(ROOT, envFile)) ? readEnvFile(path.join(ROOT, envFile)) : {};
  const body = {
    name: runtimeName,
    description: runtimeName,
    imageUrl: image,
    flavorId,
    command: [],
    args: [],
    environmentVariables: envVars,
    autoscaling: { minReplicas: 1, maxReplicas: 1, cpuUtilization: 50, memoryUtilization: 50 },
    poc: String(poc),
    imageAuth: { enabled: true, username: cred.username, password: cred.secret },
  };

  console.log('→ create runtime...');
  const created = await createRuntime(token, body);
  if (created.status >= 400) {
    console.error('CREATE FAILED:', created.status, JSON.stringify(created.json).slice(0, 500));
    process.exit(1);
  }
  const rt = created.json;
  const id = rt.id;
  console.log(`Runtime created: id=${id} status=${rt.status}`);

  console.log('→ waiting for ACTIVE...');
  let status = rt.status;
  for (let i = 0; i < 40; i++) {
    if (status === 'ACTIVE') break;
    if (status === 'ERROR' || status === 'FAILED') { console.error('Runtime ERROR'); break; }
    await new Promise((r) => setTimeout(r, 5000));
    const cur = await getRuntime(token, id);
    status = cur.status;
    console.log(`  poll ${i + 1}: ${status}`);
  }

  const eps = await listEndpoints(token, id);
  const epList = (eps && (eps.listData || eps.data)) || [];
  const def = epList.find((e) => (e.name || '').toUpperCase() === 'DEFAULT') || epList[0];
  console.log('\n=== DEPLOYMENT COMPLETE ===');
  console.log(`Runtime:   ${runtimeName}`);
  console.log(`Runtime ID: ${id}`);
  console.log(`Status:    ${status}`);
  console.log(`Image:     ${image}`);
  if (def) console.log(`Endpoint:  ${def.url}`);
  console.log(`Console:   https://aiplatform.console.vngcloud.vn/agent-runtime?tab=runtime`);
  return { id, status, endpoint: def && def.url };
}

async function updateRuntimeApi(token, id, body) {
  const r = await req('PATCH', `${ENDPOINTS.RUNTIME}/agent-runtimes/${id}`, { bearer: token, json: body });
  return { status: r.status, json: r.json };
}

async function update(opts) {
  const { runtimeId, runtimeName, flavorId, poc, tag, envFile } = opts;
  const token = await getToken();
  const repo = await crRepo(token);
  const cred = await crCredentials(token);
  const registryUrl = repo.registryUrl;
  const repoName = repo.name;
  const image = `${registryUrl}/${repoName}/${runtimeName}:${tag}`;
  console.log(`Image: ${image}`);

  console.log('→ docker login to registry...');
  execSync(`docker login ${registryUrl} -u ${cred.username} --password-stdin`, { input: cred.secret, stdio: ['pipe', 'ignore', 'inherit'] });

  console.log('→ docker build (linux/amd64)...');
  execSync(`docker build --platform linux/amd64 -t ${image} .`, { cwd: ROOT, stdio: 'inherit' });

  console.log('→ docker push...');
  execSync(`docker push ${image}`, { cwd: ROOT, stdio: 'inherit' });

  const envVars = envFile && fs.existsSync(path.join(ROOT, envFile)) ? readEnvFile(path.join(ROOT, envFile)) : {};
  const body = {
    imageUrl: image,
    flavorId,
    description: runtimeName,
    command: [],
    args: [],
    environmentVariables: envVars,
    autoscaling: { minReplicas: 1, maxReplicas: 1, cpuUtilization: 50, memoryUtilization: 50 },
    poc: String(poc),
    imageAuth: { enabled: true, username: cred.username, password: cred.secret },
  };

  console.log(`→ update runtime ${runtimeId}...`);
  const updated = await updateRuntimeApi(token, runtimeId, body);
  if (updated.status >= 400) {
    console.error('UPDATE FAILED:', updated.status, JSON.stringify(updated.json).slice(0, 500));
    process.exit(1);
  }
  console.log(`Runtime updated: id=${runtimeId}`);

  console.log('→ waiting for ACTIVE...');
  let status = '';
  for (let i = 0; i < 40; i++) {
    const cur = await getRuntime(token, runtimeId);
    status = cur.status;
    if (status === 'ACTIVE') break;
    if (status === 'ERROR' || status === 'FAILED') { console.error('Runtime ERROR'); break; }
    await new Promise((r) => setTimeout(r, 5000));
    console.log(`  poll ${i + 1}: ${status}`);
  }

  const eps = await listEndpoints(token, runtimeId);
  const epList = (eps && (eps.listData || eps.data)) || [];
  const def = epList.find((e) => (e.name || '').toUpperCase() === 'DEFAULT') || epList[0];
  console.log('\n=== UPDATE COMPLETE ===');
  console.log(`Runtime ID: ${runtimeId}`);
  console.log(`Status:    ${status}`);
  console.log(`Image:     ${image}`);
  if (def) console.log(`Endpoint:  ${def.url}`);
  console.log(`Console:   https://aiplatform.console.vngcloud.vn/agent-runtime?tab=runtime`);
  return { id: runtimeId, status, endpoint: def && def.url };
}

module.exports = { getToken, canUsePoc, crRepo, crCredentials, flavors, listRuntimes, getRuntime, listEndpoints, createRuntime, discover, deploy, update, ENDPOINTS };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'discover') discover().catch((e) => { console.error(e.message); process.exit(1); });
  else if (cmd === 'deploy') {
    const opts = { runtimeName: process.argv[3], flavorId: process.argv[4], poc: process.argv[5] === 'true', tag: process.argv[6], envFile: process.argv[7] };
    deploy(opts).catch((e) => { console.error(e.message); process.exit(1); });
  } else if (cmd === 'update') {
    const opts = { runtimeId: process.argv[3], runtimeName: process.argv[4], flavorId: process.argv[5], poc: process.argv[6] === 'true', tag: process.argv[7], envFile: process.argv[8] };
    update(opts).catch((e) => { console.error(e.message); process.exit(1); });
  } else console.log('Usage: node src/deploy.js discover | deploy <name> <flavorId> <poc> <tag> [envFile] | update <id> <name> <flavorId> <poc> <tag> [envFile]');
}
