import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { capturePage } from './capture-page.mjs';

const editable = /^(?:src|public)\/[\w./$-]+\.(?:tsx?|css|html|svg)$/;
const contextFile = /\.(?:tsx?|css|html|svg)$/;

async function sourceContext(projectDir) {
  const files = {};
  async function visit(dir) {
    for (const item of await readdir(path.join(projectDir, dir), { withFileTypes: true })) {
      const relative = `${dir}/${item.name}`.replaceAll('\\', '/');
      if (item.isDirectory()) {
        if (!['node_modules', '.git', '.output', '.tanstack'].includes(item.name)) await visit(relative);
      } else if (contextFile.test(item.name) && !item.name.endsWith('.gen.ts')) {
        const full = path.join(projectDir, relative);
        if ((await stat(full)).size < 50000) files[relative] = await readFile(full, 'utf8');
      }
    }
  }
  for (const dir of ['src']) {
    try { await visit(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['AGENTS.md', 'package.json', 'index.html']) {
    try { files[name] = await readFile(path.join(projectDir, name), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!Object.keys(files).length) throw new Error('No website source files found in the target folder.');
  return files;
}

function filePath(projectDir, relative) {
  if (relative !== 'index.html' && !editable.test(relative)) throw new Error(`Unsupported output path: ${relative}`);
  if (relative.split('/').includes('..')) throw new Error(`Invalid output path: ${relative}`);
  const base = path.resolve(projectDir);
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw new Error(`Output leaves the target project: ${relative}`);
  return full;
}

async function codexResult({ root, projectDir, targetUrl, cli, feedback, annotations, source, onProgress }) {
  const resultFile = path.join(root, '.feedback', `${feedback.id}-result.txt`);
  await mkdir(path.dirname(resultFile), { recursive: true });
  onProgress('Capturing the current page…');
  const pageImage = await capturePage({ root, targetUrl, feedback }).catch(() => null);
  const args = [cli, 'exec', '--skip-git-repo-check', '--approve-for-me', '--ephemeral', '-C', projectDir,
    '--json', '--output-schema', path.join(root, 'agent-output.schema.json'), '-o', resultFile];
  if (pageImage) args.push('--image', pageImage);
  if (feedback.previewImage || feedback.image) args.push('--image', feedback.previewImage || feedback.image);
  args.push('-');
  const imageContext = pageImage ? 'The first attached image is the actual page screenshot. The second, when present, is the sketch on white.' : 'The attached image, when present, is the sketch on white.';
  const prompt = `You are editing the real website source. Return a JSON object matching the output schema. Do not use shell or file tools; all relevant source is below. Return complete contents for only the source files you need to change, with paths relative to the project folder. Keep the existing framework and follow AGENTS.md. Preserve unrelated content and user edits. Apply every saved annotation as an instruction on its selected element, including all requested words. ${imageContext} The sketch is a visual design brief and must be translated into real website source code, such as React/HTML components, layout, typography, colors, borders, and CSS. Never add the sketch image, a screenshot, a canvas, or an image overlay to the website. The sketch aligns to the page coordinates. The route is ${feedback.route || '/'}, and the page dimensions are ${JSON.stringify(feedback.sketchPlacement)}. Implement the design shown in the sketch in relevant source files for that route. A successful run must change website source code. If you cannot infer a detail, make a reasonable design choice and implement the clearest interpretation; never report success without a source change. Do not include the Sketchtation toolbar in output files. Respond with a brief summary.\n\nUSER NOTE:\n${feedback.note}\n\nSTACKED ANNOTATIONS:\n${JSON.stringify(annotations)}\n\nSOURCE FILES:\n${JSON.stringify(source)}`;
  onProgress(feedback.image ? 'Thinking through the sketch and page…' : 'Thinking through your design request…');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-3000); });
    let events = '';
    child.stdout.on('data', chunk => {
      events += chunk.toString();
      const lines = events.split('\n');
      events = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'turn.started') onProgress('Codex is reviewing your request…');
          if (event.type === 'item.started' && event.item?.type === 'reasoning') onProgress('Codex is planning the design change…');
          if (event.type === 'item.started' && event.item?.type === 'agent_message') onProgress('Codex is drafting source changes…');
          if (event.type === 'turn.completed') onProgress('Checking the proposed files…');
        } catch {}
      }
    });
    child.on('error', reject);
    child.on('close', async code => {
      try {
        if (code !== 0) throw new Error(errors.trim().slice(-500) || 'Codex could not finish the design change.');
        resolve(JSON.parse(await readFile(resultFile, 'utf8')));
      } catch (error) { reject(error); }
    });
    child.stdin.end(prompt);
  });
}

export async function applyProjectRun({ root, projectDir, targetUrl, cli, feedback, annotations, onProgress = () => {} }) {
  onProgress('Reading your website source…');
  const source = await sourceContext(projectDir);
  const proposed = await codexResult({ root, projectDir, targetUrl, cli, feedback, annotations, source, onProgress });
  if (!Array.isArray(proposed.files) || proposed.files.length > 8) {
    throw new Error('Codex did not return a usable website change.');
  }
  const files = new Map();
  for (const item of proposed.files) {
    if (!item || typeof item.path !== 'string' || typeof item.content !== 'string' || item.content.length > 300000) throw new Error('Codex returned an invalid source file.');
    const relative = item.path.replaceAll('\\', '/');
    if (files.has(relative)) throw new Error(`Duplicate output path: ${relative}`);
    files.set(relative, item.content);
  }
  const modelChanged = [...files].some(([relative, content]) => source[relative] !== content);
  if (feedback.image && !modelChanged) throw new Error('No website code changed. The sketch stays in your editor; add a short note about what to build and send again.');
  if (!modelChanged && annotations.length) throw new Error('No website code changed. Your comments remain queued; clarify the requested change and send again.');
  const changes = [];
  for (const [relative, content] of files) {
    const full = filePath(projectDir, relative);
    let previous = null;
    try { previous = await readFile(full, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (source[relative] !== previous && previous !== null) throw new Error(`The website changed while Codex worked: ${relative}`);
    if (previous !== content) changes.push({ relative, full, previous, content });
  }
  if (!changes.length) throw new Error('Codex made no source change. Comments remain queued.');
  onProgress('Saving the design to your website…');
  const backup = path.join(root, '.history', `${feedback.id}.json`);
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, JSON.stringify({ projectDir, files: changes.map(({ relative, previous }) => ({ path: relative, previous })) }, null, 2));
  const written = [];
  try {
    for (const item of changes) {
      await mkdir(path.dirname(item.full), { recursive: true });
      await writeFile(item.full, item.content);
      written.push(item);
    }
  } catch (error) {
    for (const item of written.reverse()) {
      if (item.previous === null) await unlink(item.full).catch(() => {});
      else await writeFile(item.full, item.previous).catch(() => {});
    }
    throw error;
  }
  const summary = String(proposed.summary || 'Website updated.').slice(0, 500);
  return { summary, changed: changes.map(item => item.relative), appliedCommentIds: annotations.map(item => item.id) };
}
