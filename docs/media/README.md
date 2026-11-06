# README media

These files are shared by the Chinese and English READMEs. Files ending in
`.en` are the English-console variants used by `README.en.md`; the unsuffixed
files stay Chinese so the two READMEs show their own language.

- `mark.svg`, `badge-*.svg`, `lang-*.svg`: local vector assets matching the console palette. Language links use separate selected and unselected states.
- `console-overview.png`, `console-overview-dark.png`: the same overview in light and dark themes.
- `console-overview.en.png`, `console-overview-dark.en.png`: English-console overview, light and dark.
- `console-settings.en.png`: English conversation settings.
- `console-settings.png`: conversation settings with contextual help.
- `companion-actions.gif`, `companion-actions.en.gif`: gestures recorded from the real console renderer, using synthetic fixture data; the `.en` variant uses the English UI.
- `companion-still.png`, `companion-still.en.png`: the static alternative for readers who prefer reduced motion.

To recapture the screenshots and GIF from the repository root:

```bash
node packages/bridge/scripts/capture-readme-media.mjs
```

The script captures both the Chinese and English variants (`?lang=en`) and requires Playwright, a browser and its video encoder, plus `ffmpeg` for GIF conversion. Existing tool installations can be selected with `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, and `FFMPEG_BIN`. It starts its own offline fixture and makes no production QQ/DSH connections or configuration writes.
