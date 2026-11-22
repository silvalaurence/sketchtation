import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
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

function filePath(projectDir, relative, allowedAsset = null) {
  if (relative !== 'index.html' && relative !== allowedAsset && !editable.test(relative)) throw new Error(`Unsupported output path: ${relative}`);
  if (relative.split('/').includes('..')) throw new Error(`Invalid output path: ${relative}`);
  const base = path.resolve(projectDir);
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw new Error(`Output leaves the target project: ${relative}`);
  return full;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngChunk(name, data) {
  const type = Buffer.from(name);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}

function cropSketchPng(png, placement) {
  if (!placement || png.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const imageData = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) return null;
    }
    if (type === 'IDAT') imageData.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (!width || !height || bitDepth !== 8 || colorType !== 6 || !placement.width || !placement.height) return null;

  const stride = width * 4;
  const decoded = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(height * stride);
  let inputOffset = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const da = Math.abs(p - a);
    const db = Math.abs(p - b);
    const dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filter = decoded[inputOffset++];
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const value = decoded[inputOffset++];
      const left = i >= 4 ? pixels[row + i - 4] : 0;
      const above = y ? pixels[row - stride + i] : 0;
      const upperLeft = y && i >= 4 ? pixels[row - stride + i - 4] : 0;
      const prediction = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
      pixels[row + i] = (value + prediction) & 255;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * stride + x * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const padding = 4;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const rows = Buffer.alloc(cropHeight * (cropWidth * 4 + 1));
  for (let y = 0; y < cropHeight; y++) {
    pixels.copy(rows, y * (cropWidth * 4 + 1) + 1, (minY + y) * stride + minX * 4, (minY + y) * stride + (minX + cropWidth) * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(cropWidth, 0);
  header.writeUInt32BE(cropHeight, 4);
  header[8] = 8;
  header[9] = 6;
  const cropped = Buffer.concat([
    png.subarray(0, 8),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const scaleX = width / placement.width;
  const scaleY = height / placement.height;
  const css = value => Math.round(value * 100) / 100;
  return {
    png: cropped,
    bounds: {
      left: css(minX / scaleX),
      top: css(minY / scaleY),
      width: css(cropWidth / scaleX),
      height: css(cropHeight / scaleY),
    },
  };
}

async function codexResult({ root, projectDir, targetUrl, feedback, annotations, source, sketchAssetUrl, sketchBounds, onProgress }) {
  const resultFile = path.join(root, '.feedback', `${feedback.id}-result.txt`);
  await mkdir(path.dirname(resultFile), { recursive: true });
  onProgress('Capturing the current page…');
  const pageImage = await capturePage({ root, targetUrl, feedback }).catch(() => null);
  const args = ['exec', '--skip-git-repo-check', '--approve-for-me', '--ephemeral', '-C', projectDir,
    '--json', '--output-schema', path.join(root, 'agent-output.schema.json'), '-o', resultFile];
  if (pageImage) args.push('--image', pageImage);
  if (feedback.previewImage || feedback.image) args.push('--image', feedback.previewImage || feedback.image);
  args.push('-');
  const imageContext = pageImage ? 'The first attached image is the actual page screenshot. The second, when present, is the sketch on white.' : 'The attached image, when present, is the sketch on white.';
  const prompt = `You are editing the real website source. Return a JSON object matching the output schema. Do not use shell or file tools; all relevant source is below. Return complete contents for only the source files you need to change, with paths relative to the project folder. Keep the existing framework and follow AGENTS.md. Preserve unrelated content and user edits. Apply every saved annotation as an instruction on its selected element, including all requested words. ${imageContext}

The sketch and page screenshot share document coordinates: x/y are CSS pixels from the page's top-left, and the full sketch canvas is ${JSON.stringify(feedback.sketchPlacement)}. The transparent asset at ${sketchAssetUrl || 'unavailable'} is cropped to the drawn marks only; its exact bounding box on the page is ${JSON.stringify(sketchBounds)}. For hand-drawn graffiti, characters, illustrations, or stickers, preserve the artist's exact marks by using this asset as a DOM image with exactly this CSS: position:absolute; left:${sketchBounds?.left}px; top:${sketchBounds?.top}px; width:${sketchBounds?.width}px; height:${sketchBounds?.height}px. Attach it to the route's page container, whose top-left is the document origin, so it scrolls with that page. Never scale this cropped image to the full page, set its width to 100%, stretch it to a page aspect ratio, move it to the viewport, or place it in Sketchtation's editor layer. Never use the page screenshot as a website asset.

If the sketch represents UI structure rather than decorative artwork, create real React/HTML/CSS elements at the corresponding document coordinates. Scope any CSS changes to the intended element or route. Preserve every existing page section, component, illustration, and style unless the request clearly asks to change it. Do not reuse or override CSS selectors for artwork already present on the page; add a separate component and uniquely scoped class for this sketch. A small sketch must not trigger a global restyle, rewrite of the stylesheet, or changes to existing artwork placement. Implement only the requested design and retain all unrelated site content and layout.

The route is ${feedback.route || '/'}. Implement the design in relevant source files for that route. A successful run must change website source code. If you cannot infer a detail, make a reasonable design choice and implement the clearest interpretation; never report success without a source change. Do not include the Sketchtation toolbar in output files. Respond with a brief summary.\n\nUSER NOTE:\n${feedback.note}\n\nSTACKED ANNOTATIONS:\n${JSON.stringify(annotations)}\n\nSOURCE FILES:\n${JSON.stringify(source)}`;
  onProgress(feedback.image ? 'Thinking through the sketch and page…' : 'Thinking through your design request…');
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_CLI_EXE || 'codex.exe', args, { cwd: projectDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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

export async function applyProjectRun({ root, projectDir, targetUrl, feedback, annotations, onProgress = () => {} }) {
  onProgress('Reading your website source…');
  const source = await sourceContext(projectDir);
  const originalSketch = feedback.image ? await readFile(feedback.image) : null;
  const croppedSketch = originalSketch && cropSketchPng(originalSketch, feedback.sketchPlacement);
  const sketchBounds = croppedSketch?.bounds || null;
  const sketchAssetRelative = croppedSketch ? `public/sketchtation-art/${feedback.id}.png` : null;
  const sketchAssetUrl = sketchAssetRelative ? `/${sketchAssetRelative.slice('public/'.length)}` : null;
  const proposed = await codexResult({ root, projectDir, targetUrl, feedback, annotations, source, sketchAssetUrl, sketchBounds, onProgress });
  if (!Array.isArray(proposed.files) || proposed.files.length > 8) {
    throw new Error('Codex did not return a usable website change.');
  }
  if (proposed.files.length === 0) throw new Error(`Codex returned no website code changes${proposed.summary ? `: ${String(proposed.summary).slice(0, 250)}` : '.'} Your sketch stays saved in Sketchtation. Add a short note describing what to build, then send again.`);
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
  const usesOriginalSketch = sketchAssetUrl && [...files.values()].some(content => content.includes(sketchAssetUrl));
  if (usesOriginalSketch) {
    const relative = sketchAssetRelative;
    const full = filePath(projectDir, relative, sketchAssetRelative);
    try {
      await stat(full);
      throw new Error(`Sketch asset already exists: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    changes.push({ relative, full, previous: null, content: croppedSketch.png });
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
