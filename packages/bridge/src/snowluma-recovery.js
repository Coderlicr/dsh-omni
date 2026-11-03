// SnowLuma 上游卡死的恢复判定（纯函数，便于测试）。
//
// 现象：桥接与 SnowLuma 的 WS 还连着，账号也在线，但 SnowLuma 的 QQ hook 卡住，
// 连续十几分钟没有任何事件包（连 30s 心跳都没有）。重启容器能清掉这个状态。
// 这里只决定「现在该不该自动重启」，真正执行由桥接负责；默认关闭，避免误伤。

export function shouldAutoRestartSnowluma({
  enabled = false,
  connected = false,
  lastPacketAt = 0,
  good = null,
  now = Date.now(),
  staleMs = 180_000,
  cooldownMs = 900_000,
  lastRestartAt = 0,
  restarting = false,
} = {}) {
  if (!enabled || !connected || restarting) return false;
  if (!Number.isFinite(Number(lastPacketAt)) || Number(lastPacketAt) <= 0) return false;
  if (lastRestartAt && now - Number(lastRestartAt) < cooldownMs) return false;
  if (good === false) return true;
  return now - Number(lastPacketAt) >= Math.max(60_000, Number(staleMs) || 180_000);
}
