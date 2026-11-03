# D 开发记录：第一步足迹写入

开发日期：2026-11-03

## 本次完成

完成第一版足迹写入功能。用户可提交一条记录，日期与经纬度必填；文字、照片、视频至少填写或选择一种。表单日期默认上海时区当天，并尝试获取浏览器当前位置；定位失败时可手动输入经纬度。

坐标会连同坐标类型一起保存。浏览器自动定位标记为 `WGS-84`，手动输入可选 `WGS-84` 或 `GCJ-02`。本次没有做坐标转换、城市识别、地图点亮或地图展示。

每条记录最多附一个文件：

- 图片：JPEG、PNG、WebP，最多 10 MiB。
- 视频：MP4、WebM，最多 100 MiB。
- 服务端检查文件签名与请求声明类型是否一致，不以文件名或扩展名判断内容。

文字、日期、经纬度、坐标类型及媒体信息保存在 PostgreSQL；照片和视频文件本体放在私有文件目录。数据库不向客户端返回磁盘路径。若媒体文件已写入但数据库事务失败，服务会尝试删除该文件。

## 新增文件

- `apps/api/src/footprints/`
  - `footprints.controller.ts`：`POST /api/footprints` 写入记录；`GET /api/footprints/media/:id` 授权读取媒体。
  - `footprints.service.ts`：写入记录和媒体元数据，处理数据库失败后的文件补偿删除。
  - `footprints.dto.ts`：校验日期、经纬度、文字、文件类型及大小。
  - `media-storage.service.ts`：私有目录中的文件读、写、删。
  - `footprints-auth.guard.ts`、`request-user.decorator.ts`：读取服务端认证用户的接口边界。只有请求已由认证模块设置有效 `request.user.id` 时才允许访问。
  - `footprints.module.ts`：足迹功能的 NestJS 模块。
- `apps/api/migrations/202611030001_footprint_entries.js`：新增 `footprint_entries` 足迹表和 `footprint_media` 媒体元数据表。媒体表与足迹按所有者建立关联，每条足迹最多一项媒体。
- `apps/api/tests/footprints.test.cjs`：输入校验、文件存储、事务失败清理及数据库写入内容的测试。
- `apps/web/src/features/footprints/FootprintEntryForm.tsx`：日期、定位、文本和单文件上传表单。
- `apps/web/src/lib/api.ts`：前端健康检查请求封装。原有 `App.tsx` 引用了该路径，但文件当时不存在。
- `packages/shared/src/footprints.ts`：前后端共用的足迹、坐标及媒体类型。

## 修改文件

- `apps/api/src/app.module.ts`：注册足迹模块。
- `apps/api/src/config/config.service.ts`：增加 `MEDIA_STORAGE_DIR` 配置；未配置时默认使用 API 工作区的 `.data/media` 目录。
- `.env.example`：说明媒体目录配置。
- `.gitignore`：忽略 `apps/api/.data/`，避免把用户文件提交到 Git。
- `apps/api/tests/config.test.cjs`：增加媒体目录配置测试。
- `apps/api/tests/migration-status.test.cjs`：将新迁移纳入迁移状态测试预期。
- `apps/web/src/App.tsx`、`apps/web/src/style.css`：将足迹表单接入当前开发页并添加样式。
- `packages/shared/src/index.ts`：导出新增共享类型。
- `docs/D-足迹与地图手账开发说明.md`、`docs/接口与数据约定.md`：同步首轮范围、字段、接口和媒体限制。

## 配置与使用说明

可在项目 `.env` 中设置 `MEDIA_STORAGE_DIR` 指定媒体存储目录；为空时文件保存在 API 工作区的 `.data/media`。生产部署需要把该目录挂载为持久化存储。

创建接口使用 `multipart/form-data`：

| 字段               | 必填 | 说明                                   |
| ------------------ | ---- | -------------------------------------- |
| `longitude`        | 是   | 经度，范围 -180 至 180                 |
| `latitude`         | 是   | 纬度，范围 -90 至 90                   |
| `coordinateSystem` | 是   | `WGS-84` 或 `GCJ-02`                   |
| `recordedOn`       | 是   | `YYYY-MM-DD`，不允许晚于上海时区当天   |
| `text`             | 否   | 最多 10,000 字符                       |
| `file`             | 否   | 一个 JPEG、PNG、WebP、MP4 或 WebM 文件 |

`text` 和 `file` 至少要有一个。用户身份来自服务端认证上下文，不接受客户端提交 `ownerId`。私人媒体读取同样需要认证；读取其他用户的媒体返回 404。

## 验证结果与未完成事项

本次验证通过：

- `npm test`：17 项测试通过。
- `npm run build --workspace=@travel/web`：前端类型检查和生产构建通过。
- `npm run typecheck`：API、Web、shared 工作区类型检查通过。
- `npm run lint`：通过。
- 本次相关代码和文档的 Prettier 检查：通过。

尚未完成或验证：

1. C 的登录认证模块尚未接入。当前 Guard 要求认证模块在请求上提供已验证的 `request.user.id`；在身份模块接通前，真实浏览器请求会返回 401，不能用前端传入的用户 ID 替代认证。
2. 尚未对真实 PostgreSQL 执行新增迁移，也未完成真实数据库写入联调。
3. 当前只实现“写入一条足迹”、“授权读取单个媒体”、位置搜索和地图统计数据接口；尚无足迹列表、编辑、删除、地图组件及行政区边界填色、完整随笔管理、多个文件和媒体清理重试机制。
4. 浏览器自动定位需要用户授权和安全上下文；无法获取定位时需手动填写经纬度。

## 第二步：地点搜索与地图统计数据

开发日期：2026-11-03

按已讨论的方案扩展足迹数据，为位置搜索和地图页面提供接口：

- 增量迁移 `202611030002_footprint_location_details.js` 为足迹增加地点名称、地址、高德 POI ID、省市名称/行政区代码和 GCJ-02 地图坐标；原始坐标与坐标系继续保留。
- 新增 `AmapLocationService`：服务端调用高德 POI 关键字搜索、POI ID 详情、GPS 转 GCJ-02 和逆地理编码。保存 POI 时以服务端重新查询到的地点信息为准，不信任浏览器提交的省市信息。
- 表单新增景点/目的地关键词搜索和结果选择。自动定位继续使用 WGS-84 原始坐标；高德服务可用时由 API 转换并反查省市。
- 新增 `GET /api/footprints/places/search?keywords=...`，返回候选 POI、经纬度、POI ID 和可用的行政区数据。
- 新增 `GET /api/footprints/map`：全国视图返回已点亮省份；传 `provinceAdcode` 返回该省已点亮城市和位置标记；汇总区分省数、市数、不同位置数和打卡记录数。
- 不同位置优先按高德 POI ID 合并；无 POI ID 的位置按相同坐标系归并到 50 米内最近代表点（包括 POI 点）。一个点的 `checkInCount` 统计该位置的打卡条目数。
- 高德服务 Key 使用服务端环境变量 `AMAP_WEB_SERVICE_KEY`，不发给浏览器。未设置 Key 时，关键词搜索不可用；手动坐标记录仍可保留原始位置，但省市未知，WGS-84 也没有可直接用于高德地图的 GCJ-02 坐标。

本步骤只做了 API、数据结构及录入表单；尚未加入高德底图、行政区边界填色或地图组件。迁移尚未在真实数据库运行；此前数据不会自动补齐省市和 POI 信息。登录模块仍需 C 接入。

按用户要求，本步骤**未运行功能测试**。仅运行工作区 TypeScript 类型检查、lint、格式检查和迁移 JavaScript 语法检查；这些检查不能证明高德 Key、真实数据库、登录链路或浏览器定位已经联通。功能测试计划与边界留待讨论后再执行。

## 本轮补充：地图开发记录与 CI 工作流说明

开发日期：2026-11-03

已将第二步 POI 搜索、省市/POI 数据存储、地图汇总接口、50 米位置归并规则及本步骤未运行功能测试的说明补入本开发记录。

本轮还查看了 C 负责人分享的 GitHub Actions 工作流内容。按提供的 YAML，它是团队持续集成检查：在 GitHub Actions Ubuntu runner 上启动一次性的 PostgreSQL 17 服务，执行项目迁移、lint、格式检查、类型检查、构建、工作区测试，以及行程和地点目录持久化验证脚本。该数据库供 CI 运行时验证使用，不是开发者本机数据库，也不会替项目实现注册、登录或令牌认证。

截至本记录更新时，该工作流文件未出现在当前本地工作区的 `.github/workflows/` 中；所给提交也不在当前本地仓库对象中，因此这里只记录对所贴 YAML 内容的说明，不记录为已在当前工作区启用或执行。该工作流若合入并成功运行，可帮助及早发现迁移和通用代码质量问题；但其列出的持久化验证脚本针对行程和地点目录，并未显示专门验证 D 的 POI 搜索、高德服务、足迹地图统计或媒体文件存储。它也没有替代 D 的针对性功能验收。

## 第三步：足迹小测试

开发日期：2026-11-03

在 `apps/api/tests/footprints.test.cjs` 增加不依赖外部服务的测试，覆盖：

- 高德 POI 搜索响应转换、省市代码提取及不完整结果过滤。
- WGS-84 坐标先转换为高德坐标，再逆地理编码并保存省市信息。
- 未配置高德 Key、转换坐标无效时明确返回错误。
- 地图数据中 POI 去重、50 米内坐标合并、省市计数及打卡条数统计；同时检查行政区未知记录仍计入总打卡和位置数。

验证命令：在 `travel-planner-v2-framework` 执行 `npm test`。结果：API 构建成功，22 项测试全部通过。

测试使用模拟的 `fetch` 响应和数据库对象，不访问真实高德服务、不连接 PostgreSQL，也不验证浏览器界面、登录认证或真实文件上传流程。完整端到端测试仍需后续在隔离测试数据库、真实测试配置及认证模块接入后进行。

## 第四步：足迹列表、详情、编辑、删除与年份筛选

开发日期：2026-11-03

按开发说明补齐足迹管理 API：

- `GET /api/footprints`：只读取当前用户的足迹，按到访日期倒序分页，可选年份筛选，返回 `{ items, page, pageSize, total }`。
- `GET /api/footprints/:id`：读取当前用户的单条足迹；他人或不存在的记录统一返回 404。
- `PATCH /api/footprints/:id`：未提供字段保留原值；支持更新文字、日期、地点和坐标，也支持保留、替换或移除单个媒体。坐标字段必须成组提交，更新后仍需至少有文字或媒体。
- `DELETE /api/footprints/:id`：在事务中删除用户自己的记录和媒体元数据；地图统计随记录集合变化自动更新。
- `GET /api/footprints/map?year=...`：和足迹列表使用相同年份筛选范围，地图汇总只根据筛选后的记录计算。

媒体文件删除采用持久化清理队列：数据库事务先把待删存储键写入 `footprint_media_cleanup`，事务成功后尝试删除文件；失败的任务保留，并在后续足迹写入操作中重试。新增迁移 `202611030003_footprint_media_cleanup.js` 创建该队列表。

测试补充了列表年份和分页参数、详情用户隔离、PATCH 校验及媒体保留/移除、媒体清理队列，以及地图年份筛选。验证结果：`npm run typecheck` 通过；`npm test` 构建成功，29 项测试全部通过。测试使用替身数据库和存储，不连接 PostgreSQL、不调用真实高德服务；本次新增迁移尚未在任何数据库执行。
