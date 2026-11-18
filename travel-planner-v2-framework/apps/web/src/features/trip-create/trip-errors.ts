import type { TransportMode } from '@travel/shared';
import { DraftSaveError, TripApiError } from './trip-draft-client';
export function tripErrorMessage(error: unknown): string {
  if (error instanceof DraftSaveError) return tripErrorMessage(error.originalError);
  if (error instanceof TripApiError) {
    if (error.status === 401) return '登录已过期，请重新登录；当前编辑内容已保留。';
    if (error.code === 'REVISION_CONFLICT')
      return '行程已被其他页面更新。请保留当前输入，返回列表重新读取，避免覆盖他人的修改。';
    if (error.code === 'SCHEDULE_RESET_REQUIRED')
      return '更改规划条件会替换每日安排，请先勾选允许重新规划。';
    if (error.status === 410) return '推荐方案已过期，请重新生成。';
    return error.message;
  }
  if (error instanceof TypeError) return '无法连接服务器，请检查后端是否启动；当前输入已保留。';
  return error instanceof Error ? error.message : '请求未完成，请重试。';
}

/**
 * 生成推荐行程时的错误提示。
 *
 * 自驾 / 公交需要真实站点间路程；服务器没有配置地图 Key 时只能返回 503，
 * 原来的文案（“缺少必要站点间路线…”）看不出该改什么，这里直接给出可行动的下一步。
 */
export function planningErrorMessage(error: unknown, transport: TransportMode): string {
  const original = error instanceof DraftSaveError ? error.originalError : error;
  if (
    original instanceof TripApiError &&
    original.code === 'DEPENDENCY_UNAVAILABLE' &&
    (transport === 'driving' || transport === 'transit')
  ) {
    const label = transport === 'driving' ? '自驾' : '公交';
    return `当前出行方式是「${label}」，需要地图服务计算站点之间的路程，但服务器还没有配置高德 Key。请把出行方式改成「步行」再生成，或先配置 AMAP_WEB_SERVICE_KEY。`;
  }
  return tripErrorMessage(error);
}
