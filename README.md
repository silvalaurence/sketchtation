<img src="site/logo.svg" alt="Sketchtation" width="370">

Sketchtation places a floating design toolbar over your real localhost website. The website remains in its own project. No OpenAI API key is needed; Send uses your signed-in local Codex CLI.

## Run

1. Start your website's development server.
2. Copy `sketchtation.config.example.json` to `sketchtation.config.json` and set `targetUrl` and `projectDir`. The local config is ignored by Git.
3. Run `npm start` in Sketchtation, then open `http://127.0.0.1:4173`. The page at `targetUrl` appears with the toolbar at the bottom.
4. Draw directly on the page or select elements and stack comments. Drawings and comments belong to the current route; changing pages hides them, and returning to a route restores its unsent drawing.
5. Press **Send** to apply the current page's note, sketch, and stacked comments to the real website source. The status bubble reports each stage of the run. Sketchtation captures the page and a white sketch preview for Codex, then preserves the original transparent drawing on that route. The page refreshes after a successful update. Comments that were not applied remain queued.

Run `codex login` once if the local CLI is not signed in. You may also set `SKETCHTATION_TARGET_URL` and `SKETCHTATION_PROJECT_DIR` environment variables instead of a config file.

## Files

- `server.mjs` — local API and toolbar delivery
- `proxy.mjs` — localhost website and development WebSocket proxy
- `project-agent.mjs` — checked source changes from the local Codex CLI
- `capture-page.mjs` — optional local page screenshot for sketch context
- `sketch-overlay.mjs` — route-specific drawing integration for TanStack sites
- `site/editor/` — dock, drawing tools, and icons
- `site/logo.svg` — README logo
- `.feedback/` and `.history/` — local feedback and backups, ignored by Git

The pens were inspired by [Drawesome](https://github.com/benjitaylor/drawesome) by Benji Taylor (MIT). The drawing code in this repository is independent plain JavaScript.
