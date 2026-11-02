// macOS 提醒事项集成（纯配置/脚本 + 注入 osascript，不创建真实提醒）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appleScriptString, buildReminderScript, createReminder, listReminderLists, normalizeRemindersConfig
} from '../src/reminders.js';

test('提醒事项配置：默认关闭、字段收敛、列表名兜底', () => {
  const d = normalizeRemindersConfig({});
  assert.equal(d.enabled, false);
  assert.equal(d.listName, 'Yuki');
  assert.equal(d.dueMinutes, 10);
  assert.equal(d.notifyOwner, true);
  const n = normalizeRemindersConfig({ enabled: 'yes', listName: '   ', dueMinutes: 999999, notifyOwner: false });
  assert.equal(n.enabled, false);
  assert.equal(n.listName, 'Yuki');
  assert.equal(n.dueMinutes, 1440);
  assert.equal(n.notifyOwner, false);
});

test('AppleScript 字符串转义，标题/正文不会破坏脚本', () => {
  assert.equal(appleScriptString('a"b\\c\nd'), 'a\\"b\\\\c\\nd');
  const script = buildReminderScript({ title: '修 "引号"', notes: '第一行\n第二行', listName: 'Yuki', dueMinutes: 5 });
  assert.match(script, /Yuki/);
  assert.match(script, /5 \* minutes/);
  assert.match(script, /修 \\"引号\\"/);
  assert.match(script, /remind me date/);
});

test('createReminder：调用 osascript 并解析 id；未启用直接拒绝', async () => {
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return { stdout: 'x-apple-reminder://TEST\n', stderr: '' };
  };
  const r = await createReminder({ title: '测试', notes: '内容', config: { enabled: true, listName: 'Yuki', dueMinutes: 3 }, execFileImpl: exec });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'x-apple-reminder://TEST');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'osascript');
  assert.equal(calls[0].args[0], '-e');
  assert.match(calls[0].args[1], /3 \* minutes/);
  const off = await createReminder({ title: 'x', config: { enabled: false }, execFileImpl: exec });
  assert.equal(off.ok, false);
});

test('createReminder：自动化权限被拒时给出可操作提示', async () => {
  const exec = async () => { const e = new Error('exec failed'); e.stderr = 'Not authorized to send Apple events to Reminders. (-1743)'; throw e; };
  const r = await createReminder({ title: '测试', config: { enabled: true }, execFileImpl: exec });
  assert.equal(r.ok, false);
  assert.match(r.error, /系统设置|自动化|提醒事项/);
});

test('listReminderLists：解析列表名', async () => {
  const exec = async () => ({ stdout: '提醒, Groceries, Yuki\n' });
  const r = await listReminderLists({ execFileImpl: exec });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lists, ['提醒', 'Groceries', 'Yuki']);
});
