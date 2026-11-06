// Static contract for the English console layer.
// The runtime translator itself is browser-only; this test keeps the dictionary,
// the toggle, and the asset route from silently drifting apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const html = fs.readFileSync(new URL('../public/console.html', import.meta.url), 'utf8');
const assets = fs.readFileSync(new URL('../src/console-assets.js', import.meta.url), 'utf8');
const dict = JSON.parse(fs.readFileSync(new URL('../public/console-assets/i18n.en.json', import.meta.url), 'utf8'));

test('console exposes a language toggle and loads the i18n engine', () => {
  assert.match(html, /id="langToggle"/, 'topbar must expose a language toggle');
  assert.match(html, /\/console-assets\/i18n\.js/, 'console must load the i18n engine');
});

test('i18n engine and dictionary are served by the allowlisted asset map', () => {
  assert.match(assets, /\/console-assets\/i18n\.js/);
  assert.match(assets, /\/console-assets\/i18n\.en\.json/);
});

test('English dictionary covers the visible navigation and core actions', () => {
  const required = ['运行总览', '会话与审批', '人格与角色', '聊天行为', '二代仿真', '长期记忆', '保存', '未知', '已连接', '我的伙伴'];
  for (const key of required) {
    assert.ok(dict[key], `missing translation for ${key}`);
    assert.notEqual(dict[key], key, `untranslated entry for ${key}`);
    assert.doesNotMatch(dict[key], /[\u4e00-\u9fff]/, `English entry still contains Chinese: ${key} => ${dict[key]}`);
  }
});

test('dictionary entries are non-empty and free of unresolved placeholders', () => {
  for (const [key, value] of Object.entries(dict)) {
    assert.ok(key && value, 'empty dictionary entry');
    assert.doesNotMatch(value, /ZXQ\d+QXZ/, `unresolved sentinel for ${key}`);
  }
});
