// macOS 提醒事项（Reminders.app）集成。
//
// 只做一件事：把 Yuki 的 bug/建议归档成一条带「提醒时间」的提醒事项。
// 不常驻、不轮询；每次工具调用才 spawn 一次 /usr/bin/osascript。
//
// 权限：macOS 会在第一次调用时弹「自动化 / 提醒事项」授权；授权一次即可。
// 拒绝时返回可读错误，由桥接决定是否落本地队列并通知主人。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export const REMINDERS_DEFAULT_LIST = 'Yuki';

export function normalizeRemindersConfig(raw = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    enabled: r.enabled === true,
    listName: String(r.listName ?? REMINDERS_DEFAULT_LIST).trim().slice(0, 40) || REMINDERS_DEFAULT_LIST,
    dueMinutes: num(r.dueMinutes, 10, 1, 24 * 60),
    notifyOwner: r.notifyOwner !== false,
  };
}

/** AppleScript 双引号字符串转义：反斜杠、双引号、换行。 */
export function appleScriptString(value, max = 2000) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .slice(0, max);
}

/** 生成创建提醒事项的脚本（纯函数，便于测试）。 */
export function buildReminderScript({ title, notes = '', listName = REMINDERS_DEFAULT_LIST, dueMinutes = 10 } = {}) {
  const safeList = appleScriptString(listName || REMINDERS_DEFAULT_LIST, 40);
  const safeTitle = appleScriptString(title, 160) || 'Yuki 待处理问题';
  const safeNotes = appleScriptString(notes, 1200);
  const minutes = Math.min(24 * 60, Math.max(1, Math.round(Number(dueMinutes) || 10)));
  return `set dueDate to (current date) + ${minutes} * minutes
tell application "Reminders"
  set listName to "${safeList}"
  set targetList to missing value
  repeat with l in lists
    if name of l is listName then set targetList to l
  end repeat
  if targetList is missing value then
    set targetList to make new list with properties {name:listName}
  end if
  set r to make new reminder at end of targetList with properties {name:"${safeTitle}", body:"${safeNotes}", due date:dueDate}
  try
    set remind me date of r to dueDate
  end try
  return id of r
end tell`;
}

function permissionError(error) {
  const text = String(error?.stderr || error?.message || error);
  if (/-1743|not authorized|automation|权限/i.test(text)) {
    return 'macOS 还没有允许 Yuki 访问提醒事项。请到「系统设置 → 隐私与安全性 → 自动化」勾选提醒事项（或允许弹出的授权）。';
  }
  return `写入提醒事项失败：${text.replace(/\s+/g, ' ').slice(0, 200)}`;
}

/**
 * 创建一条提醒事项。
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.notes]
 * @param {object} [p.config] normalizeRemindersConfig 的结果
 * @param {Function} [p.execFileImpl] 测试注入
 * @returns {Promise<{ok:boolean,id?:string,error?:string}>}
 */
export async function createReminder({ title, notes = '', config = {}, execFileImpl = runFile } = {}) {
  const cfg = normalizeRemindersConfig(config);
  if (!cfg.enabled) return { ok: false, error: '提醒事项集成未启用' };
  const script = buildReminderScript({ title, notes, listName: cfg.listName, dueMinutes: cfg.dueMinutes });
  try {
    const { stdout } = await execFileImpl('osascript', ['-e', script], {
      timeout: 15000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8'
    });
    const id = String(stdout ?? '').trim();
    return { ok: true, id: id || null, listName: cfg.listName, dueMinutes: cfg.dueMinutes };
  } catch (error) {
    return { ok: false, error: permissionError(error) };
  }
}

/** 只读探活：不创建任何提醒，返回列表名。 */
export async function listReminderLists({ execFileImpl = runFile } = {}) {
  try {
    const { stdout } = await execFileImpl('osascript', ['-e', 'tell application "Reminders" to get name of every list'], {
      timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8'
    });
    return { ok: true, lists: String(stdout ?? '').split(',').map((s) => s.trim()).filter(Boolean) };
  } catch (error) {
    return { ok: false, error: permissionError(error) };
  }
}
