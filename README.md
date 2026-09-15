# agent-skillz

Agent skills I wrote for my own use, in the [Agent Skills](https://skills.sh)
format: a `SKILL.md` with frontmatter, plus the scripts and references it
points at. They work in Claude Code, Codex, Cursor and anything else that
reads `SKILL.md`.

## Install

```sh
npx skills add jonjaques/agent-skillz --skill icon-composer -g
```

Drop `-g` to install into the current project instead of your user directory.
`npx skills add jonjaques/agent-skillz --all` takes everything.

## Skills

### `icon-composer`

Build, inspect and verify Apple Icon Composer `.icon` bundles (the layered
Liquid Glass app icon format, Xcode 26+) without opening the GUI.

- A dependency-free Node library for generating bundles from a script:
  colour and gradient helpers, per-appearance specializations, group and
  layer builders that refuse the combinations `ictool` silently mishandles,
  and SVG helpers for rounded rects, stroked outlines and tapered ribbons.
- `inspect` and `validate` commands that lint for the mistakes `ictool` does
  not report (misspelled keys, a plain key shadowing its `-specializations`,
  dangling image references), then render every rendition on every platform.
- `preview.sh`, which renders contact sheets (light / dark / tinted / clear,
  80 px and 40 px, design generation 27 vs 26) so an agent can actually look
  at what it built.
- A file-format reference established by probing `ictool` rather than reading
  docs, including which Icon Composer 27 keys change the render and which are
  accepted but inert.
- Design notes on what makes a Liquid Glass icon read well, and a complete
  worked generator to copy.

Requires macOS with Xcode 26 or later. Verified against Icon Composer 27.0.

## License

MIT. See [LICENSE](LICENSE).
