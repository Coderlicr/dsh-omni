// SnowLuma 上游卡死的自动重启策略（纯函数）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldAutoRestartSnowluma } from '../src/snowluma-recovery.js';

test('默认关闭；未连接/没有收到过包/冷却中都不重启', () => {
  assert.equal(shouldAutoRestartSnowluma({}), false);
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: false, lastPacketAt: 1, now: 999999, staleMs: 1 }), false);
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: true, lastPacketAt: 0, now: 999999, staleMs: 1 }), false);
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: true, lastPacketAt: 1000, now: 999999, staleMs: 60000, lastRestartAt: 990000, cooldownMs: 900000 }), false);
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: true, lastPacketAt: 1000, now: 999999, staleMs: 60000, restarting: true }), false);
});

test('超过 staleMs 自动重启；good=false 立刻触发', () => {
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: true, lastPacketAt: 1000, now: 1000 + 180001, staleMs: 180000 }), true);
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: true, lastPacketAt: 1000, now: 2000, staleMs: 180000, good: false }), true);
});

test('冷却后会允许下一次重启', () => {
  assert.equal(shouldAutoRestartSnowluma({ enabled: true, connected: true, lastPacketAt: 1000, now: 1000000, staleMs: 60000, lastRestartAt: 1000, cooldownMs: 900000 }), true);
});
