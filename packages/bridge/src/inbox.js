// 长消息全文仓（inbox）。
//
// 为什么需要它：`appendSocialV2Message` 把每条消息压到 200 字再存进 social-v2.json，
// 被截掉的后半段**没有第二份副本**——`qq_get_message_detail` 自己也写着
// 「这里不是读取长消息全文的入口」。结果是群友贴一段报错日志/长需求，模型永远只能看到前 200 字，
// 而且它连"我少看了东西"都无法确认（`textTruncated` 只说明被截断，没地方补）。
//
// 设计取舍（三条）：
//   1. **只存被截断的消息**。普通聊天一个字都不写盘：既避免状态文件随聊天记录膨胀，
//      也避免把整份群聊原文落到磁盘（这与记忆模块"候选只存内容+来源，不存聊天原文全集"的口径一致）。
//   2. **追加写 + 有界**。每个会话最多保留最近 maxLines 条长消息，超出后整体重写为最后一段。
//   3. **失败只记日志，不影响消息入库**。长消息仓是"可选的补读能力"，不能因为它写失败
//      把一条正常消息丢掉（所以 put 内部自己 try/catch，调用方不需要处理）。
import fs from 'node:fs';
import path from 'node:path';

/** 与 appendSocialV2Message 的预览长度保持一致：超过这个长度才值得存全文。 */
export const INLINE_LIMIT = 200;

/** 每个会话保留的长消息条数。足够覆盖"刚刚贴过来的那段"，又不会让文件无限长。 */
export const MAX_LINES = 200;

/**
 * 会话 key → 文件名。`group:123` 这类 key 含冒号，直接当文件名在 Windows 上不合法。
 * 只保留字母数字和下划线，其余折叠成一个下划线；空结果用 `session` 兜底。
 */
export function inboxFileName(key) {
  const safe = String(key ?? '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe || 'session'}.jsonl`;
}

/** 仓里一条记录的判据：够长、有 messageId 可回查。纯函数，测试直接钉。 */
export function shouldStoreFull(text, limit = INLINE_LIMIT) {
  return typeof text === 'string' && text.length > limit;
}

/**
 * @param {object} options
 * @param {string} options.dir 存放目录（通常是 data/inbox）
 * @param {number} [options.limit] 触发存全文的长度阈值
 * @param {number} [options.maxLines] 每个会话保留条数
 * @param {(msg: string) => void} [options.log]
 * @param {typeof fs} [options.fsImpl] 测试注入用
 */
export function createInbox({ dir, limit = INLINE_LIMIT, maxLines = MAX_LINES, log = () => {}, fsImpl = fs } = {}) {
  if (!dir) throw new Error('inbox 需要 dir');
  const counts = new Map(); // file -> 已知行数；懒加载，避免每次 put 都读一遍文件

  const fileFor = (key) => path.join(dir, inboxFileName(key));

  function ensureDir() {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  function countLines(file) {
    if (counts.has(file)) return counts.get(file);
    let n = 0;
    try {
      const text = fsImpl.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) if (line.trim()) n += 1;
    } catch {
      n = 0;
    }
    counts.set(file, n);
    return n;
  }

  function trim(file) {
    const kept = [];
    try {
      const text = fsImpl.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        kept.push(line);
        if (kept.length > maxLines) kept.shift();
      }
    } catch {
      return;
    }
    const tmp = `${file}.tmp`;
    try {
      fsImpl.writeFileSync(tmp, kept.join('\n') + (kept.length ? '\n' : ''), { mode: 0o600 });
      fsImpl.renameSync(tmp, file);
      counts.set(file, kept.length);
    } catch (error) {
      try { fsImpl.unlinkSync(tmp); } catch {}
      log(`inbox: 截断失败（保留原文件）：${error?.message ?? error}`);
    }
  }

  /**
   * 存一条超长消息。返回是否真的落盘（调用方只需要知道"能不能补读"）。
   * 同一 messageId 重复写入会被跳过——网关重连重发同一条事件时不该产生两行。
   */
  function put({ key, messageId, seq, time = Date.now(), text }) {
    if (!shouldStoreFull(text, limit)) return false;
    const id = messageId == null ? '' : String(messageId);
    if (!id) return false;
    try {
      ensureDir();
      const file = fileFor(key);
      if (get({ key, messageId: id })) return true;
      const line = JSON.stringify({ id, seq: seq ?? null, t: time, text: String(text) });
      fsImpl.appendFileSync(file, line + '\n', { mode: 0o600 });
      const n = countLines(file) + 1;
      counts.set(file, n);
      if (n > maxLines) trim(file);
      return true;
    } catch (error) {
      log(`inbox: 保存长消息失败（不影响消息入库）：${error?.message ?? error}`);
      return false;
    }
  }

  /** 按 messageId 取回全文；没有就返回 null。 */
  function get({ key, messageId }) {
    const id = messageId == null ? '' : String(messageId);
    if (!id) return null;
    let text = '';
    try {
      text = fsImpl.readFileSync(fileFor(key), 'utf8');
    } catch {
      return null;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row = null;
      try { row = JSON.parse(line); } catch { continue; }
      if (row && String(row.id) === id && typeof row.text === 'string') return row.text;
    }
    return null;
  }

  return { put, get, fileFor, limit };
}
