import type { Coordinates, FootprintMapCity, FootprintMapLocation } from '@travel/shared';

/**
 * D 交给 A 嵌入的地图组件属性。
 *
 * 与 `docs/D-足迹与地图手账开发说明.md` 第 3 节的目标接口保持一致，字段名按当前
 * `packages/shared/src/footprints.ts` 的契约落定：
 * - 文档里的 `VisitedPlace[]` 即 `GET /api/footprints/map` 返回的 `FootprintMapLocation[]`；
 * - 文档里的 `litCities[].visitCount` 在共享契约中叫 `checkInCount`。
 *
 * 组件只接收数据并回调用户操作，不决定登录、路由或保存请求；A 收到回调后打开详情
 * 或到访表单，保存成功后重新请求 `GET /api/footprints/map` 再把新数据传进来。
 */
export interface FootprintMapProps {
  /** 已按位置去重的地图点；无法确认行政区的记录也会保留在这里。 */
  markers: FootprintMapLocation[];
  /** 已点亮城市；只有实际到访参与点亮，计划中的行程不算。 */
  litCities: FootprintMapCity[];
  /** 当前选中的位置 ID；为空表示未选中。 */
  selectedVisitedPlaceId: string | null;
  /** 数据请求进行中；为 true 时组件显示加载态。 */
  loading: boolean;
  /** 数据请求失败信息；非空时组件以错误态展示，地图与列表仍可访问。 */
  errorMessage: string | null;
  /** 点击地图标记或列表项时触发，参数为 `FootprintMapLocation.locationId`。 */
  onSelectVisitedPlace: (visitedPlaceId: string) => void;
  /** 点击地图空白处时触发，坐标为高德可直接绘制的 GCJ-02。 */
  onPickLocation: (coordinates: Coordinates) => void;
  /** 地图容器高度，默认 420px；A 可用它适配页面布局。 */
  height?: number;
  /**
   * 开发与测试用开关：不加载地图 SDK，只验证列表、状态与回调。
   * 不传或传 false 时按正常流程加载地图。
   */
  disableMapSdk?: boolean;
}
