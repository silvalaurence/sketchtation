import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { proxyRequest, proxyUpgrade } from './proxy.mjs';
import { applyProjectRun } from './project-agent.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const editorDir = path.join(root, 'site', 'editor');
const feedbackDir = path.join(root, '.feedback');
const port = Number(process.env.PORT || 4173);
const execFileAsync = promisify(execFile);
const cli = process.env.CODEX_CLI_JS || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const runs = new Map();
const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
let config = {};
try { config = JSON.parse(await readFile(path.join(root, 'sketchtation.config.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const targetText = process.env.SKETCHTATION_TARGET_URL || config.targetUrl;
const targetUrl = targetText ? new URL(targetText) : null;
const projectText = process.env.SKETCHTATION_PROJECT_DIR || config.projectDir;
const projectDir = projectText ? path.resolve(projectText) : null;
if (targetUrl && (targetUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(targetUrl.hostname)
  || Number(targetUrl.port) === port)) throw new Error('Target URL must be a different localhost HTTP port.');

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8000000) throw new Error('Request is too large.');
  }
  return JSON.parse(raw);
}
function placement(value) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)
    || value.width < 1 || value.height < 1 || value.width > 20000 || value.height > 20000) return null;
  return { width: Math.round(value.width), height: Math.round(value.height) };
}
async function annotations() {
  try { return JSON.parse(await readFile(path.join(feedbackDir, 'annotations.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function saveFeedback(input) {
  const note = String(input.note || '').slice(0, 10000).trim();
  const sketch = input.sketch;
  if (!note && !sketch) throw new Error('Add a note or sketch.');
  if (sketch && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sketch) || sketch.length > 7000000)) throw new Error('Invalid sketch image.');
  await mkdir(feedbackDir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const image = sketch ? path.join(feedbackDir, `${id}.png`) : null;
  if (image) await writeFile(image, Buffer.from(sketch.split(',')[1], 'base64'));
  const target = input.target && typeof input.target.selector === 'string' && Number.isFinite(input.target.x) && Number.isFinite(input.target.y)
    ? { selector: input.target.selector.slice(0, 200), x: input.target.x, y: input.target.y } : null;
  const feedback = { id, note, image, sketchPlacement: image ? placement(input.sketchPlacement) : null, target, createdAt: new Date().toISOString() };
  await writeFile(path.join(feedbackDir, 'pending.json'), JSON.stringify(feedback, null, 2));
  if (target) await writeFile(path.join(feedbackDir, 'annotations.json'), JSON.stringify([...(await annotations()), feedback], null, 2));
  return feedback;
}
async function clearApplied(sent) {
  if (!sent.length) return 0;
  const before = await annotations();
  const ids = new Set(sent.map(item => item.id));
  const after = before.filter(item => !ids.has(item.id));
  await writeFile(path.join(feedbackDir, 'annotations.json'), JSON.stringify(after, null, 2));
  return before.length - after.length;
}
async function startAgent(input) {
  if (!projectDir) throw Object.assign(new Error('Set projectDir in sketchtation.config.json to edit your real website.'), { status: 409 });
  if ([...runs.values()].some(run => run.status === 'running')) throw Object.assign(new Error('The agent is already working on this site.'), { status: 409 });
  try { await readFile(cli); } catch { throw Object.assign(new Error('Codex CLI is not installed.'), { status: 503 }); }
  try { await execFileAsync(process.execPath, [cli, 'login', 'status'], { timeout: 10000, windowsHide: true }); }
  catch { throw Object.assign(new Error('Run codex login in PowerShell, then send again.'), { status: 409 }); }
  const stacked = await annotations();
  if (!String(input.note || '').trim() && !input.sketch && !stacked.length) throw Object.assign(new Error('Add a sketch, comment, or design note first.'), { status: 400 });
  const feedback = await saveFeedback({ note: String(input.note || '').trim() || (input.sketch ? 'Apply my sketch to the website design.' : 'Apply my stacked comments.'), sketch: input.sketch, sketchPlacement: input.sketchPlacement });
  const run = { id: feedback.id, status: 'running', message: 'Codex is designing your website.', result: '' };
  runs.set(run.id, run);
  applyProjectRun({ root, projectDir, cli, feedback, annotations: stacked })
    .then(async result => {
      const cleared = await clearApplied(stacked);
      run.status = 'complete';
      run.message = 'Website updated.';
      run.result = `${result.summary}${cleared ? ` Cleared ${cleared} applied comment${cleared === 1 ? '' : 's'}.` : ''}`;
    })
    .catch(error => { run.status = 'failed'; run.message = error.message; });
  return run;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith('/__sketchtation/')) {
      if (targetUrl) return proxyRequest(req, res, targetUrl);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__sketchtation/editor/toolbar.css"></head><body><script type="module" src="/__sketchtation/editor/toolbar.js"></script></body></html>');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/__sketchtation/editor/')) {
      const relative = decodeURIComponent(url.pathname.slice('/__sketchtation/editor/'.length));
      const file = path.resolve(editorDir, relative);
      if (!file.startsWith(editorDir + path.sep)) return send(res, 404, { error: 'Not found.' });
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      return res.end(data);
    }
    if (req.method === 'GET' && url.pathname === '/__sketchtation/api/status') return send(res, 200, { targetUrl: targetUrl?.origin || null, projectDir });
    if (req.method === 'GET' && url.pathname === '/__sketchtation/api/annotations') return send(res, 200, await annotations());
    if (req.method === 'GET' && url.pathname === '/__sketchtation/api/run') return send(res, 200, runs.get(url.searchParams.get('id')) || { status: 'unknown', message: 'Run not found.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: 'Invalid origin.' });
    if (req.method === 'POST' && url.pathname === '/__sketchtation/api/feedback') return send(res, 200, await saveFeedback(await body(req)));
    if (req.method === 'POST' && url.pathname === '/__sketchtation/api/run') return send(res, 202, await startAgent(await body(req)));
    if (req.method === 'DELETE' && url.pathname === '/__sketchtation/api/annotations') {
      const id = url.searchParams.get('id') || '';
      if (!/^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(id)) return send(res, 400, { error: 'Invalid comment.' });
      const before = await annotations();
      const after = before.filter(item => item.id !== id);
      if (after.length === before.length) return send(res, 404, { error: 'Comment not found.' });
      await writeFile(path.join(feedbackDir, 'annotations.json'), JSON.stringify(after, null, 2));
      try { const pending = JSON.parse(await readFile(path.join(feedbackDir, 'pending.json'), 'utf8')); if (pending.id === id) await unlink(path.join(feedbackDir, 'pending.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return send(res, 200, { removed: id });
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (error) { send(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.message }); }
});
server.on('upgrade', (req, socket, head) => {
  if (!targetUrl || req.url.startsWith('/__sketchtation/')) return socket.destroy();
  proxyUpgrade(req, socket, head, targetUrl);
});
server.listen(port, '127.0.0.1', () => console.log(`Sketchtation: http://127.0.0.1:${port}${targetUrl ? ` → ${targetUrl.origin}` : ''}`));
