#!/usr/bin/env node
// README media from synthetic console data. No production config or QQ/DSH calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startConsoleFixture } from './console-ui-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || resolve(here, '../../../docs/media'));
const scratch = await mkdtemp(join(tmpdir(), 'dsh-readme-media-'));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await startConsoleFixture();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const errors = [];
const blocked = [];
const run = promisify(execFile);
await mkdir(output, { recursive: true });

async function context(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block', ...options });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === fixture.url) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  return context;
}
async function open(context, lang = 'zh') {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(lang === 'en' ? `${fixture.url}/?lang=en` : fixture.url);
  await page.waitForSelector('#companionStage[data-rig-ready="ready"]');
  await page.waitForFunction(() => document.getElementById('v2AgentPreset').value === 'qq-chat-v2');
  if (lang === 'en') {
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    // The runtime translator fetches the dictionary asynchronously; wait for a
    // known translated label before capturing so screenshots never race it.
    await page.waitForFunction(() => document.querySelector('[data-view="overview"]')?.textContent.includes('Overview'));
    await page.waitForTimeout(200);
  }
  return page;
}

async function captureStills(lang, suffix) {
  const stills = await context({ viewport: { width: 1440, height: 1260 } });
  try {
    const page = await open(stills, lang);
    const resetViewport = () => page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    const screenshot = async name => {
      const footer = await page.locator('.page-footer').boundingBox();
      await page.screenshot({ path: join(output, name), clip: { x: 0, y: 0, width: 1440, height: Math.min(1260, Math.ceil(footer.y + footer.height + 24)) }, animations: 'disabled' });
    };
    await page.locator('.mascot-motion-toggle').click();
    await page.mouse.move(10, 10);
    await resetViewport();
    await screenshot(`console-overview${suffix}.png`);
    await page.locator('#companionStage').screenshot({ path: join(output, `companion-still${suffix}.png`), animations: 'disabled' });
    await page.locator('#themeToggle').click();
    await resetViewport();
    await screenshot(`console-overview-dark${suffix}.png`);
    await page.locator('#themeToggle').click();
    await page.locator('[data-category="chat"]').click();
    await page.locator('#pageNav [data-view="social-v2"]').click();
    await resetViewport();
    await page.locator('#v2ProactiveProbability + .help-trigger').hover();
    await page.locator('#parameterTooltip').waitFor({ state: 'visible' });
    await screenshot(`console-settings${suffix}.png`);
  } finally {
    await stills.close();
  }
}

async function captureAnimation(lang, suffix) {
  const recording = await context({ recordVideo: { dir: scratch, size: { width: 1440, height: 1100 } } });
  const recordingStart = Date.now();
  let demo;
  let trimStart = 0;
  let area = null;
  try {
    demo = await open(recording, lang);
    await demo.locator('#companionHome').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    trimStart = Math.max(0, (Date.now() - recordingStart) / 1000 - .1);
    area = await demo.locator('#companionStage').boundingBox();
    await demo.waitForTimeout(2000);
    for (const hotspot of ['eyes', 'ears', 'head', 'heart', 'memory']) {
      await demo.locator(`[data-hotspot="${hotspot}"]`).hover();
      await demo.waitForTimeout(1250); // Deliberate hold for readable animation frames.
    }
    await demo.locator('[data-mascot-action="cheer"]').click();
    await demo.waitForTimeout(1500);
    await demo.locator('.companion-more>summary').click();
    await demo.locator('[data-mascot-action="yawn"]').click();
    await demo.waitForTimeout(1600);
    const endArea = await demo.locator('#companionStage').boundingBox();
    assert.deepEqual(endArea, area, 'The demo capture region must stay fixed');
  } finally {
    await recording.close();
  }
  const video = await demo.video().path();
  const rect = [area.width, area.height, area.x, area.y].map(Math.round).join(':');
  const filters = `crop=${rect},fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  await run(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(trimStart), '-i', video, '-filter_complex', filters, '-loop', '0', join(output, `companion-actions${suffix}.gif`)]);
}

try {
  await captureStills('zh', '');
  await captureStills('en', '.en');
  await captureAnimation('zh', '');
  await captureAnimation('en', '.en');
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  assert.deepEqual(fixture.unknownRequests, []);
  assert.equal(fixture.requests.length, 0, 'Capturing media must not write application settings');
  for (const name of ['console-overview.png', 'console-overview-dark.png', 'console-settings.png', 'companion-still.png', 'companion-actions.gif',
    'console-overview.en.png', 'console-overview-dark.en.png', 'console-settings.en.png', 'companion-still.en.png', 'companion-actions.en.gif']) {
    console.log(`${name}: ${Math.round((await stat(join(output, name))).size / 1024)} KiB`);
  }
  console.log('Saved synthetic console screenshots and gesture GIFs to ' + output);

} finally {
  await browser.close(); await fixture.close();
}
