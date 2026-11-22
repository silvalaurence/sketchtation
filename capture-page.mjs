import { access, mkdir, stat, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function capturePage({ root, targetUrl, feedback }) {
  if (!targetUrl) return null;
  const browser = process.env.SKETCHTATION_BROWSER || edge;
  try { await access(browser); } catch { return null; }
  const output = path.join(root, '.feedback', `${feedback.id}-page.png`);
  const profile = path.join(root, '.feedback', `browser-${feedback.id}`);
  await mkdir(path.dirname(output), { recursive: true });
  const page = new URL(feedback.route || '/', targetUrl);
  const width = Math.max(800, Math.min(feedback.sketchPlacement?.width || 1280, 2400));
  const height = Math.max(700, Math.min(feedback.sketchPlacement?.height || 900, 4000));
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions', '--no-first-run',
    '--hide-scrollbars', '--virtual-time-budget=2500', `--user-data-dir=${profile}`, `--screenshot=${output}`,
    `--window-size=${width},${height}`, page.href];
  const child = spawn(browser, args, { windowsHide: true, stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  await Promise.race([closed, delay(20000)]);
  for (let attempt = 0; attempt < 8; attempt++) {
    try { if ((await stat(output)).size > 1000) {
      if (profile.startsWith(path.join(root, '.feedback') + path.sep)) await rm(profile, { recursive: true, force: true }).catch(() => {});
      return output;
    } } catch {}
    await delay(500);
  }
  if (profile.startsWith(path.join(root, '.feedback') + path.sep)) await rm(profile, { recursive: true, force: true }).catch(() => {});
  return null;
}
