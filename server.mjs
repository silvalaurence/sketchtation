import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.join(root, 'site');
const historyDir = path.join(root, '.history');
const feedbackDir = path.join(root, '.feedback');
const files = { html: path.join(siteDir, 'index.html'), css: path.join(siteDir, 'styles.css') };
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.env.PORT || 4173);
const execFileAsync = promisify(execFile);
const runs = new Map();
const cli = process.env.CODEX_CLI_JS || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

async function readSite() { return { html: await readFile(files.html, 'utf8'), css: await readFile(files.css, 'utf8') }; }
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 8_000_000) throw new Error('Request is too large.'); }
  return JSON.parse(raw);
}
function validSite(value) {
  return value && typeof value.html === 'string' && typeof value.css === 'string'
    && value.html.length < 300_000 && value.css.length < 300_000
    && !/<script\b/i.test(value.html) && !/javascript:/i.test(value.html);
}
function sketchPlacement(value) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)
    || value.width < 1 || value.height < 1 || value.width > 20000 || value.height > 20000) return null;
  return { width: Math.round(value.width), height: Math.round(value.height) };
}
function appliedSketches(html) { return html.match(/<img\b[^>]*\bdata-sketchtation-sketch="[^"]+"[^>]*>/g) || []; }
function escapeHtml(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function visibleText(value) { return value.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function applyLiteralTextComments(proposed, annotations) {
  const changed = [];
  for (const item of annotations) {
    const selector = item.target?.selector || '';
    if (!/^#[\w-]+$/.test(selector)) continue;
    const request = String(item.note || '').split('\n')[0].trim();
    const match = request.match(/\b(?:text|title|heading|copy)\b.*?\bto\s+(.+)$/i);
    if (!match) continue;
    const desired = match[1].trim().replace(/^(["'“‘])|(["'”’])$/g, '');
    if (!desired) continue;
    const id = selector.slice(1);
    const element = new RegExp('(<([a-z][\\w-]*)\\b[^>]*\\bid=["\\\']' + id + '["\\\'][^>]*>)([\\s\\S]*?)(</\\2>)', 'i');
    const found = proposed.html.match(element);
    if (!found) continue;
    const current = visibleText(found[3]);
    if (current.toLocaleLowerCase() === desired.toLocaleLowerCase()) continue;
    const suffix = desired.toLocaleLowerCase().startsWith(current.toLocaleLowerCase()) ? desired.slice(current.length) : null;
    const content = suffix === null ? escapeHtml(desired) : found[3] + escapeHtml(suffix);
    proposed.html = proposed.html.replace(element, (_, open, tag, inner, close) => open + content + close);
    changed.push(selector);
  }
  return changed;
}
async function placeSketch(proposed, current, feedback) {
  const retained = appliedSketches(current.html);
  const present = new Set(appliedSketches(proposed.html).map(tag => tag.match(/data-sketchtation-sketch="([^"]+)"/)?.[1]));
  const additions = retained.filter(tag => !present.has(tag.match(/data-sketchtation-sketch="([^"]+)"/)?.[1]));
  if (feedback.image && feedback.sketchPlacement) {
    const asset = path.join(siteDir, 'sketches', `${feedback.id}.png`);
    await mkdir(path.dirname(asset), { recursive: true });
    await copyFile(feedback.image, asset);
    const { width, height } = feedback.sketchPlacement;
    additions.push(`<img data-sketchtation-sketch="${feedback.id}" src="/site/sketches/${feedback.id}.png" alt="" aria-hidden="true" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;max-width:none;pointer-events:none;mix-blend-mode:multiply;z-index:10">`);
  }
  if (additions.length) proposed.html = proposed.html.replace(/<\/body>/i, `${additions.join('')}\n</body>`);
  return proposed;
}
async function saveSite(next) {
  if (!validSite(next)) throw new Error('The proposed site contains unsupported or oversized content.');
  const previous = await readSite();
  await mkdir(historyDir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(historyDir, `${id}.json`), JSON.stringify(previous, null, 2));
  await writeFile(files.html, next.html);
  await writeFile(files.css, next.css);
  return id;
}
async function saveFeedback(input) {
  const note = String(input.note || '').slice(0, 10000).trim();
  const sketch = input.sketch;
  if (!note && !sketch) throw new Error('Add a note or sketch.');
  if (sketch && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sketch) || sketch.length > 7_000_000)) throw new Error('Invalid sketch image.');
  await mkdir(feedbackDir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const image = sketch ? path.join(feedbackDir, `${id}.png`) : null;
  if (image) await writeFile(image, Buffer.from(sketch.split(',')[1], 'base64'));
  const target = input.target && typeof input.target.selector === 'string' && Number.isFinite(input.target.x) && Number.isFinite(input.target.y)
    ? { selector: input.target.selector.slice(0, 200), x: input.target.x, y: input.target.y } : null;
  const annotationsFile = path.join(feedbackDir, 'annotations.json');
  const feedback = { id, note, image, sketchPlacement: sketch ? sketchPlacement(input.sketchPlacement) : null, target, file: path.join(feedbackDir, 'pending.json'), annotationsFile, site: files, createdAt: new Date().toISOString() };
  await writeFile(path.join(feedbackDir, 'pending.json'), JSON.stringify(feedback, null, 2));
  if (target) {
    let annotations=[];
    try { annotations=JSON.parse(await readFile(annotationsFile,'utf8')); } catch(error) { if(error.code!=='ENOENT') throw error; }
    annotations.push({ id, note, target, image, createdAt: feedback.createdAt });
    await writeFile(annotationsFile, JSON.stringify(annotations, null, 2));
  }
  return feedback;
}
async function clearAppliedAnnotations(sent) {
  if (!sent.length) return 0;
  const annotationsFile = path.join(feedbackDir, 'annotations.json');
  const sentIds = new Set(sent.map(item => item.id));
  const latest = JSON.parse(await readFile(annotationsFile, 'utf8'));
  const remaining = latest.filter(item => !sentIds.has(item.id));
  await writeFile(annotationsFile, JSON.stringify(remaining, null, 2));
  return latest.length - remaining.length;
}
async function startAgent(input) {
  if ([...runs.values()].some(run => run.status === 'running')) throw Object.assign(new Error('The agent is already working on this site.'), { status: 409 });
  try { await readFile(cli); } catch { throw Object.assign(new Error('Codex CLI is not installed. Install it to send directly.'), { status: 503 }); }
  try { await execFileAsync(process.execPath, [cli, 'login', 'status'], { timeout: 10000, windowsHide: true }); }
  catch { throw Object.assign(new Error('Codex CLI is not signed in. Run “codex login” in PowerShell once, then send again.'), { status: 409 }); }
  let annotations = [];
  try { annotations = JSON.parse(await readFile(path.join(feedbackDir, 'annotations.json'), 'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  if (!String(input.note || '').trim() && !input.sketch && !annotations.length) throw Object.assign(new Error('Add a sketch, comment, or design instruction first.'), { status: 400 });
  const feedback = await saveFeedback({ note: String(input.note || '').trim() || (input.sketch ? 'Turn my sketch or graffiti into the actual website design.' : 'Apply my saved comments to the website.'), sketch: input.sketch, sketchPlacement: input.sketchPlacement });
  const current = await readSite();
  const resultFile = path.join(feedbackDir, `${feedback.id}-result.txt`);
  const run = { id: feedback.id, status: 'running', message: 'Codex is designing your website.', result: '' };
  runs.set(run.id, run);
  const args = [cli, 'exec', '--skip-git-repo-check', '--approve-for-me', '--ephemeral', '-C', root, '--output-schema', path.join(root, 'agent-output.schema.json'), '-o', resultFile];
  if (feedback.image) args.push('--image', feedback.image);
  args.push('-');
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-3000); });
  child.stdout.on('data', () => {});
  child.on('error', error => { run.status = 'failed'; run.message = error.message; });
  child.on('close', async code => {
    if (run.status === 'failed') return;
    try {
      if (code !== 0) throw new Error(errors.trim().slice(-500) || 'Codex could not finish the design change.');
      const proposed = JSON.parse(await readFile(resultFile, 'utf8'));
      if (!validSite(proposed)) throw new Error('Codex returned an invalid website design. Try again.');
      const correctedText = applyLiteralTextComments(proposed, annotations);
      if (proposed.html === current.html && proposed.css === current.css && !feedback.sketchPlacement) throw new Error('Codex did not change the website. Try a more specific instruction.');
      const latest = await readSite();
      if (latest.html !== current.html || latest.css !== current.css) throw new Error('The website changed while Codex was working. Send the request again.');
      await saveSite(await placeSketch(proposed, current, feedback));
      const cleared = await clearAppliedAnnotations(annotations);
      run.status = 'complete';
      run.message = 'Website updated.';
      run.result = (correctedText.length ? `Updated text in ${correctedText.join(', ')}. ` : '') + String(proposed.summary || 'Design applied.').slice(0, 350) + (cleared ? ` Cleared ${cleared} applied comment${cleared===1?'':'s'}.` : '');
    } catch (error) { run.status = 'failed'; run.message = error.message; }
  });
  child.stdin.end(`You are the visual design agent for a live website. Return a complete JSON object matching the provided output schema. Do not use shell or file tools; all relevant context is below. Change the HTML and CSS to apply the user's request with high visual quality. The HTML must be a complete document linking /site/styles.css. Keep it responsive and accessible. The local server injects the Sketchtation toolbar, so do not include toolbar code in the HTML. The attached image, when present, is the user's sketch in exact page coordinates. The server places that original sketch on the page after your changes, so design around its location and do not move, redraw, or duplicate it. Preserve any existing data-sketchtation-sketch images in CURRENT HTML. Every SAVED COMMENT is a user instruction about its target element and must be applied. For a text change, include every word requested in the comment's first line, even if the existing text is similar. Do not say a comment is already applied unless its full requested text is present. Summary must briefly describe the change.\n\nUSER REQUEST:\n${feedback.note}\n\nSKETCH PLACEMENT:\n${JSON.stringify(feedback.sketchPlacement)}\n\nSAVED COMMENTS:\n${JSON.stringify(annotations)}\n\nCURRENT HTML:\n${current.html}\n\nCURRENT CSS:\n${current.css}`);
  return run;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/site') return send(res, 200, await readSite());
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}`) return send(res, 403, { error: 'Invalid origin.' });
      return send(res, 202, await startAgent(await body(req)));
    }
    if (req.method === 'GET' && url.pathname === '/api/run') return send(res, 200, runs.get(url.searchParams.get('id')) || { status: 'unknown', message: 'Run not found.' });
    if (req.method === 'POST' && url.pathname === '/api/feedback') return send(res, 200, await saveFeedback(await body(req)));
    if (req.method === 'GET' && url.pathname === '/api/feedback') return send(res, 200, JSON.parse(await readFile(path.join(feedbackDir, 'pending.json'), 'utf8')));
    if (req.method === 'GET' && url.pathname === '/api/annotations') {
      try { return send(res, 200, JSON.parse(await readFile(path.join(feedbackDir, 'annotations.json'), 'utf8'))); }
      catch(error) { if(error.code==='ENOENT') return send(res, 200, []); throw error; }
    }
    if (req.method === 'DELETE' && url.pathname === '/api/annotations') {
      const id = url.searchParams.get('id') || '';
      if (!/^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(id)) return send(res, 400, { error: 'Invalid comment.' });
      const annotationsFile = path.join(feedbackDir, 'annotations.json');
      const annotations = JSON.parse(await readFile(annotationsFile, 'utf8'));
      const remaining = annotations.filter(item => item.id !== id);
      if (remaining.length === annotations.length) return send(res, 404, { error: 'Comment not found.' });
      await writeFile(annotationsFile, JSON.stringify(remaining, null, 2));
      try { const pending = JSON.parse(await readFile(path.join(feedbackDir, 'pending.json'), 'utf8')); if (pending.id === id) await unlink(path.join(feedbackDir, 'pending.json')); } catch(error) { if (error.code !== 'ENOENT') throw error; }
      return send(res, 200, { removed: id });
    }
    if (req.method === 'POST' && url.pathname === '/api/apply') return send(res, 200, { version: await saveSite(await body(req)) });
    if (req.method === 'GET' && url.pathname === '/api/history') {
      await mkdir(historyDir, { recursive: true });
      const { readdir } = await import('node:fs/promises');
      return send(res, 200, (await readdir(historyDir)).filter(x => x.endsWith('.json')).sort().reverse());
    }
    if (req.method === 'POST' && url.pathname === '/api/restore') {
      const { version } = await body(req);
      if (!/^\d{4}-\d\d-\d\dT[\d-]+Z\.json$/.test(version)) return send(res, 400, { error: 'Invalid version.' });
      const previous = JSON.parse(await readFile(path.join(historyDir, version), 'utf8'));
      return send(res, 200, { version: await saveSite(previous) });
    }
    const pathname = url.pathname === '/' ? '/site/index.html' : url.pathname;
    const target = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!target.startsWith(root + path.sep) || !/^\/site\//.test(pathname)) return send(res, 404, { error: 'Not found.' });
    let data = await readFile(target);
    if (pathname === '/site/index.html') {
      const page = data.toString('utf8')
        .replace('</head>', '<link rel="stylesheet" href="/site/editor/toolbar.css"></head>')
        .replace('</body>', '<script type="module" src="/site/editor/toolbar.js"></script></body>');
      data = Buffer.from(page);
    }
    res.writeHead(200, { 'Content-Type': `${types[path.extname(target)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'; frame-src 'self'" });
    res.end(data);
  } catch (error) { send(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.message }); }
}).listen(port, '127.0.0.1', () => console.log(`Sketchtation: http://127.0.0.1:${port}`));
