import { readFile, writeFile, mkdir, readdir, stat, copyFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

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

async function codexResult({ root, projectDir, cli, feedback, annotations, source }) {
  const resultFile = path.join(root, '.feedback', `${feedback.id}-result.txt`);
  await mkdir(path.dirname(resultFile), { recursive: true });
  const args = [cli, 'exec', '--skip-git-repo-check', '--approve-for-me', '--ephemeral', '-C', projectDir,
    '--output-schema', path.join(root, 'agent-output.schema.json'), '-o', resultFile];
  if (feedback.image) args.push('--image', feedback.image);
  args.push('-');
  const sketchUrl = feedback.image ? `/sketchtation/sketches/${feedback.id}.png` : null;
  const prompt = `You are editing the real website source. Return a JSON object matching the output schema. Do not use shell or file tools; all relevant source is below. Return complete contents for only the source files you need to change, with paths relative to the project folder. Keep the existing framework and follow AGENTS.md. Preserve unrelated content and user edits. Apply every saved annotation as an instruction on its selected element, including all requested words. When a sketch is attached, make it part of the actual website design at its page coordinates. The image will be available at ${sketchUrl}; reference that URL in a changed component if you use the original drawing. The sketch page dimensions are ${JSON.stringify(feedback.sketchPlacement)}. Do not include the Sketchtation toolbar in output files. Respond with a brief summary.\n\nUSER NOTE:\n${feedback.note}\n\nSTACKED ANNOTATIONS:\n${JSON.stringify(annotations)}\n\nSOURCE FILES:\n${JSON.stringify(source)}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-3000); });
    child.stdout.on('data', () => {});
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

export async function applyProjectRun({ root, projectDir, cli, feedback, annotations }) {
  const source = await sourceContext(projectDir);
  const proposed = await codexResult({ root, projectDir, cli, feedback, annotations, source });
  if (!Array.isArray(proposed.files) || proposed.files.length < 1 || proposed.files.length > 8) {
    throw new Error('Codex did not return a usable website change.');
  }
  const changes = [];
  const seen = new Set();
  for (const item of proposed.files) {
    if (!item || typeof item.path !== 'string' || typeof item.content !== 'string' || item.content.length > 300000) {
      throw new Error('Codex returned an invalid source file.');
    }
    const relative = item.path.replaceAll('\\', '/');
    const full = filePath(projectDir, relative);
    if (seen.has(relative)) throw new Error(`Duplicate output path: ${relative}`);
    seen.add(relative);
    let previous = null;
    try { previous = await readFile(full, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (source[relative] !== previous && previous !== null) throw new Error(`The website changed while Codex worked: ${relative}`);
    if (previous !== item.content) changes.push({ relative, full, previous, content: item.content });
  }
  if (!changes.length) throw new Error('Codex made no source change. Comments remain queued.');
  if (feedback.image && !changes.some(item => item.content.includes(`/sketchtation/sketches/${feedback.id}.png`))) {
    throw new Error('Codex did not place the sketch in the website source. Comments remain queued.');
  }
  const backup = path.join(root, '.history', `${feedback.id}.json`);
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, JSON.stringify({ projectDir, files: changes.map(({ relative, previous }) => ({ path: relative, previous })) }, null, 2));
  const written = [];
  const sketchDest = feedback.image ? path.join(projectDir, 'public', 'sketchtation', 'sketches', `${feedback.id}.png`) : null;
  try {
    if (sketchDest) {
      await mkdir(path.dirname(sketchDest), { recursive: true });
      await copyFile(feedback.image, sketchDest);
    }
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
    if (sketchDest) await unlink(sketchDest).catch(() => {});
    throw error;
  }
  return { summary: String(proposed.summary || 'Website updated.').slice(0, 500), changed: changes.map(item => item.relative) };
}
