// 会话内的「这件事」（thread）。
//
// 为什么需要它：唤醒快照只带"最近 N 条未读 + 最近几条"。群里一插话，跨轮的事就断了——
// A 说"帮我看看 X"，B 插两句，A 三分钟后说"算了看 Y"，模型只会看到三条独立消息，
// 不会知道后两句是同一件事。长期记忆解决的是"跨会话记住一个人"，这条解决的是
// "跨轮次记住一件事"，两者不能互相替代（也不该混写：thread 是短期上下文，记忆是长期资产）。
//
// 为什么不做话题/关键词推断：群聊里关键词碰撞太频繁（"这个""那个""哈哈"），
// 误合并的代价是模型把两件事当成一件，比接不上更糟。这里只用两条硬信号：
//   1. 回复链（人明确指着某条说）—— 最强；
//   2. 同一个人在窗口内的连续发言（连发、补充、改口）。
// 两者都不命中就开新 thread；宁可多开，不可错并。
import crypto from 'node:crypto';

/** 同一个人隔多久还算"同一件事"。10 分钟：够覆盖一口气说完/补充，又不至于把半小时前的事粘过来。 */
export const THREAD_WINDOW_MS = 10 * 60 * 1000;

/** 快照里最多补几条同 thread 的更早消息。太多会把窗口预算吃光。 */
export const THREAD_LIMIT = 6;

/** 从 OneBot 消息段里取被引用消息的 id。纯同步：不查网关，拿不到就是 null。 */
export function extractReplyTargetId(segments) {
  if (!Array.isArray(segments)) return null;
  for (const seg of segments) {
    if (seg?.type === 'reply' && seg.data?.id != null) return String(seg.data.id);
  }
  return null;
}

/** 新 thread 的 id：用 messageId 做种子，日志里能和具体消息对上。 */
function newThreadId(messageId, at) {
  if (messageId != null) {
    const tail = String(messageId).replace(/[^0-9A-Za-z]/g, '').slice(-12);
    if (tail) return `t${tail}`;
  }
  return `t${crypto.createHash('sha1').update(String(at)).digest('hex').slice(0, 8)}`;
}

/**
 * 给一条新消息定 thread。
 * @returns {{ threadId: string, via: 'reply'|'same-sender'|'new' }}
 */
export function resolveThreadId({
  messageId = null,
  userId = null,
  at = Date.now(),
  replyToId = null,
  recent = [],
  windowMs = THREAD_WINDOW_MS
} = {}) {
  const list = Array.isArray(recent) ? recent.filter((m) => m && typeof m === 'object') : [];

  // 1. 回复链：人已经明确指定在说哪句，直接继承。
  if (replyToId != null) {
    const target = [...list].reverse().find((m) => m.messageId != null && String(m.messageId) === String(replyToId));
    if (target?.threadId) return { threadId: target.threadId, via: 'reply' };
  }

  // 2. 同一个人窗口内继续说：连发、补充、改口都算同一件事。
  if (userId != null) {
    const prev = [...list].reverse().find((m) => m && !m.isSelf && m.threadId
      && String(m.userId ?? '') === String(userId));
    if (prev && at - Number(prev.time ?? 0) <= windowMs) {
      return { threadId: prev.threadId, via: 'same-sender' };
    }
  }

  return { threadId: newThreadId(messageId, at), via: 'new' };
}

/**
 * 从一段消息里挑出同一 thread 的更早消息（快照用）。
 * 按时间正序返回，最多 limit 条；excludeSeqs 里的（已经出现在 messages/recent 里）跳过。
 */
export function threadSlice(messages, threadId, { limit = THREAD_LIMIT, excludeSeqs = new Set() } = {}) {
  if (!threadId || !Array.isArray(messages) || limit <= 0) return [];
  const picked = [];
  for (const msg of messages) {
    if (!msg || msg.threadId !== threadId) continue;
    if (excludeSeqs.has(msg.seq)) continue;
    picked.push(msg);
  }
  return picked.slice(-limit);
}
