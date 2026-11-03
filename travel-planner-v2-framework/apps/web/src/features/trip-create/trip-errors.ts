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
