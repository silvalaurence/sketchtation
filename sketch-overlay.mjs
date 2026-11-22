import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rootRoute = 'src/routes/__root.tsx';
const component = 'src/components/site/sketchtation-overlay.tsx';
const registry = 'public/sketchtation/sketches.json';
const componentSource = `import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";

type Sketch = { id: string; route: string; src: string; width: number; height: number };

export function SketchtationOverlay() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [sketches, setSketches] = useState<Sketch[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/sketchtation/sketches.json", { cache: "no-store" })
      .then((response) => response.json() as Promise<Sketch[]>)
      .then((items) => { if (active && Array.isArray(items)) setSketches(items); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return <>{sketches.filter((item) => item.route === pathname).map((item) => (
    <img key={item.id} src={item.src} alt="" aria-hidden="true" style={{
      position: "absolute", left: 0, top: 0, width: item.width, height: item.height,
      maxWidth: "none", pointerEvents: "none", zIndex: 2147480000,
    }} />
  ))}</>;
}
`;

export async function planSketchOverlay({ projectDir, feedback, source, files }) {
  if (!feedback.image) return;
  const routeText = files.get(rootRoute) ?? source[rootRoute];
  if (!routeText || !routeText.includes('<Outlet />')) {
    throw new Error('This project needs a TanStack root route to place sketches in the real website.');
  }
  let nextRoute = routeText;
  if (!nextRoute.includes('SketchtationOverlay')) {
    nextRoute = `import { SketchtationOverlay } from "@/components/site/sketchtation-overlay";\n${nextRoute}`;
    nextRoute = nextRoute.replace(/(\n[ \t]*<Outlet \/>)/, '$1\n      <SketchtationOverlay />');
    files.set(rootRoute, nextRoute);
  }
  if (!files.has(component) && !source[component]) files.set(component, componentSource);
  let previous = [];
  try { previous = JSON.parse(await readFile(path.join(projectDir, registry), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(previous)) throw new Error('The sketch registry is invalid.');
  const { width, height } = feedback.sketchPlacement || {};
  if (!width || !height) throw new Error('The sketch is missing its page dimensions.');
  const entry = { id: feedback.id, route: feedback.route || '/', src: `/sketchtation/sketches/${feedback.id}.png`, width, height };
  files.set(registry, JSON.stringify([...previous.filter(item => item.id !== feedback.id), entry], null, 2) + '\n');
}
