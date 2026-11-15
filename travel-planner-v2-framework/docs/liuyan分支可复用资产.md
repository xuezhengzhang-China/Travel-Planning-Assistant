# liuyan 分支可复用资产说明

> 结论：`origin/liuyan` **没有合并进 `sunjiayi`**，也**不建议合并**。它上面有 17 个独有文件，其中只有 1 项（图片压缩逻辑）值得取用，已落到 `apps/web/src/lib/compress-image.ts`。
>
> 这份文档的用途：被问到「是不是漏合了 liuyan」时，直接拿它回答。

---

## 1. liuyan 分支是什么

| 项                   | 值                                                         |
| -------------------- | ---------------------------------------------------------- |
| 分支头               | `f84d7bf` `Fix lint issues`                                |
| 未进 sunjiayi 的提交 | 4 个                                                       |
| 顶层目录             | `Travel-Planning-Assistant-V1/` + `.github/` + `README.md` |
| 文件总数             | 76 个（其中 62 个在 `Travel-Planning-Assistant-V1/` 下）   |

它是一个**独立的旧版本快照**：目录名直接叫 `Travel-Planning-Assistant-V1`，内容与当前的 `travel-planner-v2-framework/` 是同源的不同阶段，前端以 `localStorage` 存数据，不调后端接口。

## 2. 为什么说它「没合」

三条可复现的验证：

```bash
# 1) sunjiayi 的完整历史里，这个路径出现 0 次提交
git log --oneline origin/sunjiayi -- Travel-Planning-Assistant-V1/
# → 无输出

# 2) liuyan 的分支头不是 main 或 sunjiayi 的祖先
git merge-base --is-ancestor origin/liuyan origin/sunjiayi; echo $?   # → 1

# 3) 当前分支里搜不到它独有的文件
git ls-tree -r --name-only origin/sunjiayi | grep -E 'pca-code.json|TravelJournal|DestinationPicker'
# → 无输出
```

同理，`origin/zhaofutao` 的 `travel-planner-v2/`（32 个文件）和 `original-source/`（5117 个文件）也从未进过 `sunjiayi`。但 **C 的框架代码已经通过 `week-8/zhaofutao` 合并进来了**（合并提交 `ea43088`），所以 `zhaofutao` 只是归档目录没合，代码是合了的。

## 3. 17 个独有文件的逐条判定

| 文件                                                  | 规模    | 判定                         | 理由                                                                                                                  |
| ----------------------------------------------------- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TravelJournal.tsx`                                   | 118 行  | **只取图片压缩逻辑**         | 其余部分是 `localStorage` 原型（key `wander-travel-journals`），与 `/api/journals` 是两套数据来源，搬进来会有两个手账 |
| `FootprintMap.tsx`                                    | 175 行  | 放弃                         | 当前已有接 API 的版本 `apps/web/src/features/footprints/FootprintMap.tsx`（196 行），两份实现会打架                   |
| `DestinationPicker.tsx`                               | 36 行   | 放弃                         | 基于 **adcode**；当前 `NewTripPage` 选城市用 DB 的 **UUID**（`city.id`），对接不上                                    |
| `destinations.ts`                                     | 40 行   | 放弃                         | 同上，是 `DestinationPicker` 的数据层                                                                                 |
| `FoldSection.tsx`                                     | 6 行    | 放弃                         | 只是 `DestinationPicker` 的折叠容器，样式耦合在 `trip-features.css` 里                                                |
| `pca-code.json`                                       | 137 KB  | **放弃，留作备查**           | 见 §5                                                                                                                 |
| `streets.json`                                        | 4.15 MB | 放弃                         | 街道级下钻用，演示不需要，体积是仓库负担                                                                              |
| `footprintStore.ts`                                   | 61 行   | 放弃                         | `localStorage` 存取；`litCityCodes` / `explorationCount` 与后端 `FootprintMapData.cities[].checkInCount` 重复         |
| `footprintData.ts`                                    | 58 行   | 放弃，`loadRegions` 留作备查 | `localStorage` + IndexedDB 视频；`loadRegions` 见 §5                                                                  |
| `TripPreparation.tsx`                                 | 148 行  | 放弃                         | 行程准备 / 提醒 UI，超出 MVP                                                                                          |
| `tripReminders.ts`                                    | 56 行   | 放弃                         | 购票 15 天推算、打包建议、ICS 日历导出，超出 MVP                                                                      |
| `footprint-store.test.mjs`                            | 64 行   | 放弃                         | 测的是被放弃的 `footprintStore.ts`                                                                                    |
| `trip-features.test.mjs`                              | 82 行   | 放弃                         | 测的是被放弃的 `tripReminders.ts`                                                                                     |
| `footprint.css` / `journal.css` / `trip-features.css` | 119 行  | 放弃                         | 依附于上面被放弃的组件                                                                                                |

## 4. 本次实际取走的内容

**`apps/web/src/lib/compress-image.ts`** —— 从 `TravelJournal.tsx` 的 `preparePhoto` 改造而来：

- 原实现：canvas 缩到最长边 1600px、JPEG 质量 0.8、透明底填白、返回 `dataURL`；
- 改造成：返回 `File`，可直接 `FormData.append('file', …)` 交给 `POST /api/media`；
- 补齐：空文件 / 非图片 / 超限的显式错误码，`createImageBitmap` 不可用时退回 `<img>` 解码并回收 objectURL，压缩后仍超 10 MiB 时降质量重试一次。

配套测试 `apps/web/tests/compress-image.test.mjs` 覆盖纯函数部分（`fitWithin`、`validateImageFile`）；canvas 相关行为需在浏览器人工验证。

## 5. 留作备查的两个资产

这两样现在用不上，但将来要做「省份填色」或「离线全国城市目录」时可以直接取，**不必再翻分支**。

### 5.1 `pca-code.json`（137 KB，省市区三级目录）

```bash
git show origin/liuyan:Travel-Planning-Assistant-V1/apps/web/public/data/pca-code.json > /tmp/pca-code.json
```

**为什么不取**：地图省份筛选不需要它——`GET /api/footprints/map` 返回的 `FootprintMapData.provinces[]` 已经带 `provinceAdcode` / `provinceName`；而行程选城市用的是 DB 的 UUID，adcode 对不上。取进来只会多一份与 API 重复的目录。

**什么时候需要**：前端要离线展示全国省市区、或需要一张「adcode ↔ 名称」的本地映射表时。

### 5.2 `loadRegions`（省份行政区边界）

`footprintData.ts` 里这个函数是**唯一一处**说明了「省份填色数据从哪来」：

```ts
fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`);
```

两个必须知道的限制：

1. 它是**外部网络依赖**（阿里 DataV），没有 SLA，演示现场可能不可用；
2. 返回的是 GeoJSON，要自己画，不是高德底图自带的。

所以「省份行政区填色」在 `第一次检查前任务总览.md` 里被列为本次不做，是有依据的，不是偷懒。

## 6. 如果将来要合并这个分支

不要直接 `git merge origin/liuyan`：会把 `Travel-Planning-Assistant-V1/` 整个 62 个文件的旧版本搬进来，与现有框架形成两份重复实现。

推荐做法：按 §3 的判定逐个 `git show` 取文件，取一个适配一个，每次取完跑 `npm run typecheck` + 前端测试。本次取 `compress-image.ts` 就是这么做的。
