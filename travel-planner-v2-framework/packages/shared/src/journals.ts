/**
 * 手账（随笔）与到访记录的关系契约。
 *
 * 与 `docs/接口与数据约定.md` 的目标模型一致，字段名按已实现的足迹模型落定：
 * 契约里的 `visitedPlaceId` 在这里叫 `footprintId`，指向 `GET /api/footprints` 的到访记录。
 * 首期只支持纯文本随笔，`mediaIds` 固定为空数组，多图关联在后续迭代加入。
 */
export interface Journal {
  id: string;
  /** 所属到访记录；删除到访会级联删除其随笔，删除随笔不影响到访与城市点亮。 */
  footprintId: string;
  title: string | null;
  /** 纯文本，按文本渲染，不渲染 HTML。 */
  body: string;
  /** 首期恒为空；图片关联实现后按顺序返回媒体 ID。 */
  mediaIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalListPage {
  items: Journal[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateJournalInput {
  footprintId: string;
  title?: string;
  body: string;
}
