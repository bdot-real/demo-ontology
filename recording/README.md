# Recording: the demo video (site tour + beats 4–6)

The brief's fallback and LinkedIn video (#17, about 3 minutes, never over 4): a quick tour of onto.melx.buzz, then beats 4–6. Edited and exported in [FilmCraft](../../filmcraft) through its MCP server. Every shot is the real thing: the interactive Compliance Agent (`agent/run.sh`) on a fresh staging registry, the staging registry's diff pages, and the public PR #21 and its CI job.

```sh
git worktree add --detach /Users/Shared/maplewood-demo HEAD          # once: the camera's working copy
ln -s "$PWD/.staging" /Users/Shared/maplewood-demo/.staging
(cd recording && npm install)

node recording/capture.mjs take5     # ~6 min: staging, beats 4-6, agent sessions → .recording/raw/take5
node recording/render.mjs  take5     # redact, check every screen, render 1080p clips → .recording/clips/take5
node recording/site.mjs    take5     # ~40 s: the site tour on production (public pages, logged out)
node recording/render.mjs  take5
node recording/edit.mjs    take5 [siteTake]  # FilmCraft: cut, captions, titles, export → .recording/maplewood-onto-demo.mp4
```

Needs tmux, asciinema, agg and ffmpeg (Homebrew), Chrome, and Playwright from any local project (`PLAYWRIGHT_FROM`, plus `npx playwright install ffmpeg` once). `.recording/` is git-ignored: footage and the video stay local.

## How each shot is made

- **Terminal**: asciinema records the real session inside a detached tmux pane at 140×34, typed at a human pace. agg renders it with the Monokai theme at 22 px.
- **Browser**: Playwright with the installed Chrome and a clean profile, so pages are the logged-out public view. The viewport is 1477 px wide and upscaled to 1080p. Headless Chrome's video leaves the bottom ~11% unpainted, so the viewport is recorded taller and cropped.
- **Site tour**: one continuous logged-out take of the production site. Headless video has no pointer, so a drawn cursor shows the clicks. Screen recording of the real desktop works too, but it would film whatever else is on screen.
- **Scroll back** (beat 6): the re-run answer is longer than the terminal, so by the end the position table has scrolled off. `scrollback.mjs` replays the session in a headless terminal and takes the answer verbatim, colours included. It then films a scroll through it, captioned as such.

## What the video must not show, and how that's enforced

- **Presenter details:** the Claude Code banner shows the plan, the working folder and a login notice.
  - The camera works from `/Users/Shared/maplewood-demo`, so no personal path exists anywhere.
  - `render.mjs` removes the plan name, the login notice and Claude Code's promo tips from the stream.
  - It then replays every cast in a headless terminal and fails if any screen still contains a forbidden string.
- **The presenter's editor:** the agent runs with `CLAUDE_CODE_AUTO_CONNECT_IDE=false`, so the IDE connection (which shows the open file) is off.
- **Untruthful claims:**
  - Agent working time is sped up only where a caption says so, with the factor.
  - The 2027 QST rate is labelled hypothetical.
  - Both cards say "For demonstration, not tax advice".
  - There's no "10/10" claim for the 3.x PRs, which have each run CI once.
