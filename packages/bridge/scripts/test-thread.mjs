// 会话内「这件事」（thread）的纯函数测试。
//
// 这里唯一的判断标准是：**宁可多开一个 thread，也不要把两件事粘成一件**。
// 所以测试除了钉住"该合并的合并"，还要钉住"不该合并的绝不合并"（不同人、超窗口）。
import assert from 'node:assert/strict';
import { extractReplyTargetId, resolveThreadId, threadSlice, THREAD_WINDOW_MS } from '../src/thread.js';

let failed = 0;
function ok(cond, label) {
  if (cond) console.log(`✅ ${label}`);
  else { failed = 1; console.error(`❌ ${label}`); }
}

// ── 回复链 ───────────────────────────────────────────────────────────────────
ok(extractReplyTargetId([{ type: 'reply', data: { id: 123 } }, { type: 'text', data: { text: 'x' } }]) === '123',
  '从消息段里取出被引用 id');
ok(extractReplyTargetId([{ type: 'text', data: { text: 'x' } }]) === null, '没有引用段时返回 null');
ok(extractReplyTargetId(null) === null, '非数组输入不抛错');

const t0 = 1_700_000_000_000;
const recent = [
  { seq: 1, messageId: '100', userId: 'A', time: t0, threadId: 't100' },
  { seq: 2, messageId: '101', userId: 'B', time: t0 + 30_000, threadId: 't101' }
];

const byReply = resolveThreadId({ messageId: '102', userId: 'B', at: t0 + 60_000, replyToId: '100', recent });
ok(byReply.threadId === 't100' && byReply.via === 'reply', '回复谁就继承谁的 thread（即使不是同一个人）');

const bySender = resolveThreadId({ messageId: '103', userId: 'A', at: t0 + 60_000, recent });
ok(bySender.threadId === 't100' && bySender.via === 'same-sender', '同一个人在窗口内继续说 → 同一 thread');

const tooLate = resolveThreadId({ messageId: '104', userId: 'A', at: t0 + THREAD_WINDOW_MS + 1, recent });
ok(tooLate.via === 'new' && tooLate.threadId !== 't100', '超过窗口就开新 thread（不把半小时前的事粘过来）');

const otherPerson = resolveThreadId({ messageId: '105', userId: 'C', at: t0 + 60_000, recent });
ok(otherPerson.via === 'new', '不同的人、没有引用 → 不合并');

const unknownReply = resolveThreadId({ messageId: '106', userId: 'C', at: t0 + 60_000, replyToId: '999', recent });
ok(unknownReply.via === 'new', '回复了一条本地没见过的消息 → 只能开新 thread（不猜）');

const noIds = resolveThreadId({ at: t0, recent: [] });
ok(typeof noIds.threadId === 'string' && noIds.threadId.startsWith('t'), '没有任何 id 时也能生成 thread');

// ── 取同 thread 的更早消息 ───────────────────────────────────────────────────
const all = [
  { seq: 1, threadId: 't100' },
  { seq: 2, threadId: 't101' },
  { seq: 3, threadId: 't100' },
  { seq: 4, threadId: 't100' }
];
const slice = threadSlice(all, 't100', { limit: 2 });
ok(slice.map((m) => m.seq).join() === '3,4', '只取同 thread，且保留最近的 limit 条（时间正序）');
const excluded = threadSlice(all, 't100', { limit: 5, excludeSeqs: new Set([4]) });
ok(excluded.map((m) => m.seq).join() === '1,3', '已经在快照里的不再重复');
ok(threadSlice(all, null).length === 0, '没有 threadId 时返回空');
ok(threadSlice(all, 't100', { limit: 0 }).length === 0, 'limit=0 时返回空（可关闭）');

if (failed) { console.error('FAILED'); process.exit(1); }
console.log('all thread tests passed');
