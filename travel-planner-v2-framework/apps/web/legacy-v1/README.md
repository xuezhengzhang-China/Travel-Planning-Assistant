# legacy-v1：来自 liuyan 分支的 V1 前端页面

> 这里保存的是 `origin/liuyan` 分支 `Travel-Planning-Assistant-V1/apps/web` 的前端源码快照。
> **它不是当前应用的运行代码**，不会被打包、不会被类型检查、也不参与格式与 lint 门禁。
> 保留它的目的：让团队能直接对照/摘取 V1 已经做好的四个主界面，而不用再翻分支。

## 1. 为什么单独放在这里

V1 是**一套完整但独立**的前端：`App.tsx` 989 行，四个 tab，数据全部存在浏览器里
（`localStorage` 键位 `wander-travel-journals` / `wander-footprints-v1` / `wander-reminders:*`，
视频放 IndexedDB `wander-media`）。它和当前 `sunjiayi` 分支上**接口驱动**的
`features/trip-create` 是两套数据层，直接混进 `src/` 会出现两个手账、两个足迹存储。

因此放在 `apps/web/legacy-v1/`，并做了三处隔离：

| 隔离点 | 位置 | 原因 |
| --- | --- | --- |
| 类型检查 | `apps/web/tsconfig.json` 的 `include` 只含 `src` 与 `vite.config.ts` | V1 代码不满足当前 `strict` 约束 |
| 格式检查 | 框架根 `.prettierignore` 排除本目录 | 避免 V1 历史格式卡住 `format:check` |
| Lint | `eslint.config.js` 的 `ignores` 排除本目录 | 同上 |
| Git | 框架 `.gitignore` 放行 `legacy-v1/src/lib/` | 父仓库有 Python 的 `lib/` 忽略规则 |

## 2. 文件清单

| 文件 | 作用 |
| --- | --- |
| `src/App.tsx` | **V1 主壳，989 行**，四个 tab：旅行助手 / 行程 / 足迹 / 我的 |
| `src/TravelJournal.tsx` | 旅行手账页（表单 + 列表 + 编辑删除 + 图片压缩） |
| `src/FootprintMap.tsx` | 足迹地图页（行政区 GeoJSON 自绘，不依赖高德底图） |
| `src/TripPreparation.tsx` | 行程准备页（购票/打包提醒、日历导出） |
| `src/DestinationPicker.tsx` | 目的地级联选择（省 / 市 / 县） |
| `src/FoldSection.tsx` | 折叠容器，`DestinationPicker` 的依赖 |
| `src/destinations.ts` | 把 `pca-code.json` 转成省市区目录的纯函数 |
| `src/footprintData.ts` | `Visit` 类型、DataV 行政区 GeoJSON 加载、IndexedDB 视频存取 |
| `src/footprintStore.ts` | 足迹 `localStorage` 存取、`litCityCodes` / `explorationCount` 等纯函数 |
| `src/tripReminders.ts` | 购票 15 天推算、打包建议、ICS 日历生成 |
| `src/*.css` | 上述页面的样式（`style.css` / `footprint.css` / `journal.css` / `trip-features.css`） |
| `src/lib/api.ts` | V1 的健康检查客户端 |
| `public/data/pca-code.json` | **全国省市区三级目录**（137 KB） |
| `tests/*.test.mjs` | V1 的两个前端测试（`footprintStore` / `tripReminders`） |
| `index.html`、`vite.config.ts` | V1 的入口与构建配置 |

## 3. 四个 tab 与后端接口的对应关系

| V1 tab | V1 组件 | 当前 `sunjiayi` 对应的接口 | 改造成本 |
| --- | --- | --- | --- |
| 旅行助手 `home` | `App.tsx` 内的首页 | `GET /api/destinations`、`GET /api/places` | 中：数据源换成接口 |
| 行程 `trips` | `App.tsx` 内的行程页 | C 的 `TripWorkspace` 已实现，**不需要移植** | — |
| 足迹 `footprints` | `FootprintMap.tsx` + `DestinationPicker` | `GET /api/footprints`、`GET /api/footprints/map` | 中：点位换成接口数据；省市归属要另找来源 |
| 我的 `profile` | `App.tsx` 内的个人页 | `GET/PATCH /api/users/me` | 低：表单直接可改 |

**唯一不建议整体移植的是数据层**：`footprintStore.ts` / `footprintData.ts` / `travel-journal` 的
localStorage 存取与后端接口重复，迁过去会出现两份真相。

## 4. 相对完整版少了什么

| 缺失项 | 原因 | 怎么取回 |
| --- | --- | --- |
| `public/data/streets.json`（4.15 MB） | 只有乡镇级下钻用到，体积大，不纳入仓库 | 见下方命令 |
| `package.json`、`tsconfig.json` | 与 `apps/web/` 现有的同名文件内容一致，避免出现重复包名 | 直接复用 `apps/web/` 的 |
| 其余 V1 目录（`apps/api` 等） | 后端已在 `apps/api` 有更完整实现 | 不需要 |

取回完整 V1 前端（含 4.15 MB 的 `streets.json`）：

```bash
git archive --format=zip -o v1web.zip origin/liuyan Travel-Planning-Assistant-V1/apps/web
```

## 5. 如果要把某一页接进正式应用

1. 先确认数据来源：**一律走 `/api`**，不要沿用 V1 的 localStorage；
2. 复制组件到 `apps/web/src/features/` 下，按当前目录结构调整 import（V1 的 `./lib/api` 要改成当前 `src/lib/api.ts` 的用法）；
3. 把页面需要的接口调用补进统一客户端（目前 `src/lib/api.ts` 只有健康检查，这是 A1 的活）；
4. 补一个纯逻辑测试，沿用 `apps/web/tests/*.test.mjs` 的 `node --test` + `ts.transpileModule` 模式；
5. 跑 `npm run typecheck`、`npm run lint`、`npm run format:check` 与前端测试。

## 6. 来源与校验

- 来源分支：`origin/liuyan`，分支头 `f84d7bf`
- 原始路径：`Travel-Planning-Assistant-V1/apps/web/`
- 提取方式：`git archive`（二进制安全，未改动任何文件内容）
- 与 `sunjiayi` 的关系：该分支**从未合并**，详见 [liuyan分支可复用资产.md](../../../docs/liuyan分支可复用资产.md)
