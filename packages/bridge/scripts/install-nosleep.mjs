#!/usr/bin/env node
/**
 * Install a per-user macOS LaunchAgent that runs `caffeinate -s` while the Mac
 * is on AC power.
 *
 * Why: the QQ gateway lives in Docker. When the Mac idle-sleeps, Docker's VM
 * pauses/restarts, the QQ client loses its session and may sit on the login
 * screen until someone scans a QR code. Keeping the system awake on AC avoids
 * that whole class of "the bot randomly stopped replying".
 *
 * `-s` only prevents system sleep on AC; the display can still sleep, and
 * closing the lid still sleeps the Mac. Unplugging releases the assertion.
 *
 * Usage:
 *   node scripts/install-nosleep.mjs            # install + start
 *   node scripts/install-nosleep.mjs --status   # show launchd / caffeinate state
 *   node scripts/install-nosleep.mjs --uninstall
 *
 * No sudo. The plist lives in ~/Library/LaunchAgents.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'nosleep-on-ac.sh');
// launchd 的 /bin/sh 读不了 ~/Documents（macOS TCC），所以安装时复制到
// Application Support；仓库里的脚本仍是唯一源文件。
const INSTALLED_SCRIPT = path.join(os.homedir(), 'Library', 'Application Support', 'dsh-omni', 'nosleep-on-ac.sh');
const LABEL = 'com.dogeheng.dsh-omni-nosleep';
const LEGACY_LABEL = 'ai.openclaw.nosleep-on-ac';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LEGACY_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LEGACY_LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs');
const LOG_FILE = path.join(LOG_DIR, 'dsh-omni-nosleep.log');
const UID = String(process.getuid?.() ?? '');
const DOMAIN = `gui/${UID}`;

function fail(message) {
  console.error(`[nosleep] ${message}`);
  process.exit(1);
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function plistText() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${xml(INSTALLED_SCRIPT)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(LOG_FILE)}</string>
</dict>
</plist>
`;
}

function launchctl(args, { ignoreFailure = false } = {}) {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (ignoreFailure) return '';
    throw error;
  }
}

function bootout(label = LABEL) {
  launchctl(['bootout', `${DOMAIN}/${label}`], { ignoreFailure: true });
}

/** The old openclaw agent pointed at a /tmp script that gets cleaned; retire it. */
function retireLegacyAgent() {
  if (!fs.existsSync(LEGACY_PLIST)) return;
  bootout(LEGACY_LABEL);
  let target = `${LEGACY_PLIST}.disabled-by-dsh-omni`;
  if (fs.existsSync(target)) target = `${target}.${Date.now()}`;
  try {
    fs.renameSync(LEGACY_PLIST, target);
    console.log(`[nosleep] retired legacy agent ${LEGACY_LABEL} -> ${path.basename(target)}`);
  } catch (error) {
    console.warn(`[nosleep] could not rename legacy plist: ${error?.message ?? error}`);
  }
}

function install() {
  if (process.platform !== 'darwin') fail('this installer currently supports macOS only');
  if (!fs.existsSync(SCRIPT)) fail(`missing ${SCRIPT}`);
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try { fs.writeFileSync(LOG_FILE, ''); } catch {}
  fs.mkdirSync(path.dirname(INSTALLED_SCRIPT), { recursive: true });
  fs.copyFileSync(SCRIPT, INSTALLED_SCRIPT);
  fs.chmodSync(INSTALLED_SCRIPT, 0o755);
  fs.writeFileSync(PLIST, plistText(), { mode: 0o644 });
  retireLegacyAgent();
  bootout();
  try {
    launchctl(['bootstrap', DOMAIN, PLIST]);
    launchctl(['enable', `${DOMAIN}/${LABEL}`], { ignoreFailure: true });
    launchctl(['kickstart', '-k', `${DOMAIN}/${LABEL}`], { ignoreFailure: true });
  } catch (error) {
    fail(`launchctl bootstrap failed: ${error?.stderr?.toString?.() ?? error?.message ?? error}`);
  }
  console.log(`[nosleep] installed ${LABEL}`);
  console.log(`[nosleep] plist:  ${PLIST}`);
  console.log(`[nosleep] script: ${SCRIPT} (installed: ${INSTALLED_SCRIPT})`);
  console.log(`[nosleep] logs:   ${LOG_FILE}`);
  console.log('[nosleep] keeps the system awake only on AC; display may still sleep');
}

function status() {
  try {
    const out = launchctl(['print', `${DOMAIN}/${LABEL}`]);
    const state = /state = (.*)/.exec(out)?.[1] ?? 'unknown';
    const pid = /pid = (.*)/.exec(out)?.[1] ?? 'none';
    console.log(`[nosleep] ${LABEL}: ${state} (pid ${pid})`);
  } catch {
    console.log(`[nosleep] ${LABEL} is not loaded`);
  }
  try {
    const assertions = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
    const line = assertions.split('\n').find((l) => l.includes('caffeinate'));
    console.log(line ? `[nosleep] ${line.trim()}` : '[nosleep] no caffeinate assertion found');
  } catch {}
}

function uninstall() {
  bootout();
  try { fs.rmSync(PLIST, { force: true }); } catch {}
  console.log(`[nosleep] removed ${LABEL}`);
}

const args = new Set(process.argv.slice(2));
if (args.has('--uninstall')) uninstall();
else if (args.has('--status')) status();
else install();
