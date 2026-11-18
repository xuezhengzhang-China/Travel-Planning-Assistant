# 随心行 C 模块接口联调约定

第 8 周合并说明：C 保留本文的公开路径。合并应用中，B 的目录、路线和推荐接口挂在 `/api/b`，可使用 C 登录获得的 Bearer 令牌。B 和 C 暂用各自的目录及候选方案存储，C 的行程确认使用 C 方案。B 的方案 ID 不能直接用于 C 的确认接口，统一目录和方案适配需要另行联调。

数据库升级以主分支的 B 迁移历史为基线。B 原有迁移和表结构继续使用，C 在其后添加 `202611060001` 至 `202611060004`，用 `c_destinations`、`c_places`、`c_recommendation_proposals` 区分存储。旧 C 独立版数据库需要另行迁移数据，本分支的迁移用于空库或已有 B 迁移的数据库。

适用版本为 `zhaofutao` 分支的 C 模块（已验收基线 `6f70d0d`）。本文区分现有接口和待团队确认的事项。所有路径均相对于 `/api`，字段定义以 `@travel/shared` 和实际接口校验为准。

## 1. 各成员怎么对接

| 成员         | C 提供                                        | 对方负责                                                                          |
| ------------ | --------------------------------------------- | --------------------------------------------------------------------------------- |
| A 正式前端   | 登录接口、行程 API、React 行程工作区          | 提供登录态、正式页面外壳和路由。行程卡片使用后端返回的 ID 与状态。                |
| B 景点与地图 | 景点目录、规则推荐、方案确认接口              | 核实景点来源及坐标，联调高德。若接入 B 的推荐服务，先统一景点字段和方案读取契约。 |
| D 足迹与手账 | 公共身份 Guard、当前用户上下文、城市和景点 ID | 定义到访、手账、媒体接口和数据表，自己维护真实到访状态。                          |

## 2. 公共认证与错误格式

- 注册 `POST /auth/register` 接收 `{ email, password, displayName }`，返回 `{ user }`。接着调用 `POST /auth/login`，用 `{ email, password }` 换取 `{ accessToken, expiresAt, user }`。
- 业务接口携带 `Authorization: Bearer <accessToken>`。`GET /users/me` 获取当前用户信息。后端通过 `AuthGuard` 和 `@CurrentUser()` 提供 `{ userId }`，业务请求体无需提供用户 ID。
- 错误格式为 `{ code, message, details? }`。前端按状态码和 `code` 分支，`message` 用于提示。400 处理参数错误，401 引导重新登录，404 处理资源不存在或当前用户无权访问。
- B/D 的测试可按 [C 开发说明](C-行程业务开发说明.md) 在测试应用内替换令牌验证，再通过真实 Guard 构造身份。

## 3. A 如何接行程

优先复用 `TripWorkspace`，由宿主传入 `user`、`getAccessToken` 和 `embedded`。入口 `entry` 使用 `{ view: 'list' }`、`{ view: 'new' }` 或 `{ view: 'edit', tripId }`。宿主通过 `onNavigate` 同步路由，使用 `onDraftSaved`、`onSaved`、`onDeleted` 更新卡片。完整示例见 [前端接入说明](随心行-前端接入说明.md)。

自行调用 API 时，按以下顺序接入。

| 操作         | 接口                                                           | 请求或结果                                                     |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------- |
| 读城市、景点 | `GET /destinations`、`GET /places?cityId=…`、`GET /places/:id` | 列表分页返回 `items/page/pageSize/total`。                     |
| 创建草稿     | `POST /trips`                                                  | `{ title, cityId }`，取得服务端 `Trip`。                       |
| 改日期和偏好 | `PATCH /trips/:id`                                             | `{ expectedRevision, planningInput }`，也可传 `title` 改名。   |
| 保存所选景点 | `PUT /trips/:id/selections`                                    | `{ expectedRevision, placeIds }`。                             |
| 生成推荐方案 | `POST /recommendations/itinerary`                              | 提交完整规划输入，返回带 `proposalId` 的方案。                 |
| 确认正式行程 | `POST /trips/:id/apply-proposal`                               | `{ expectedRevision, proposalId }`，成功后行程进入 `planned`。 |
| 保存日程编辑 | `PUT /trips/:id/schedule`                                      | `{ expectedRevision, days }`，按共享类型提交完整日程。         |
| 恢复行程     | `GET /trips`、`GET /trips/:id`                                 | 支持列表和详情。页面刷新后用服务端资源恢复。                   |
| 删除         | `DELETE /trips/:id?expectedRevision=N`                         | 成功返回 204，无响应体。                                       |

生成方案时，把 `cityId/startDate/endDate/themes/pace/transportMode/selectedPlaceIds` 作为请求体顶层字段全部提交。日期格式为 `YYYY-MM-DD`。草稿允许日期为空，生成方案需要有效日期范围和至少一个景点。PATCH 的 `planningInput` 不接受 `selectedPlaceIds`，景点选择通过 selections 接口保存。更换城市会清空已有选择。

日程项包含 `placeId/position/startTime/durationMinutes/travelMinutesFromPrevious/travelTimeSource/reason`。手动日程接口只接受已确认的行程，当前不接受客户端提交 `travelTimeSource: 'provider'`。

创建之后的写操作使用最近一次读取或保存返回的 `revision`。保存后用返回的 `Trip` 更新页面，删除成功则移除卡片。遇到 `409 REVISION_CONFLICT` 先重新读取并保留用户待处理的修改。修改已规划行程的规划条件或景点时，如收到 `409 SCHEDULE_RESET_REQUIRED`，提示用户确认清空每日安排，再对原 PATCH 或 selections 请求加 `acknowledgeScheduleReset: true` 重试。成功后回到草稿。仅改标题可保留已有安排。

## 4. B 如何接景点、地图与方案

- 目录以服务端 ID 为引用依据。`category` 是展示分类，`categories` 是主题代码。当前 `GET /places` 用 `category` 按展示分类过滤，用逗号分隔的 `themes`（如 `history,nature`）调整推荐排序，未匹配的景点仍会出现在结果中。缺失的 `coordinates`、`openingHours` 使用 `null`。合并 B 数据前共同确认分类、开放时间字段和坐标空值约定。
- `POST /routes/preview` 传 `{ from, to, transportMode }`。`POST /locations/reverse` 传 `{ coordinates }`。坐标为 `{ longitude, latitude, coordinateSystem: 'GCJ-02' }`，交通方式为 `walking/transit/driving`。服务端地图 Key 由部署环境提供。当前 C 自动排程使用估算，高德真实耗时接入排程须另行联调。
- `POST /recommendations/places` 按 `cityId/themes/pace` 返回排名和理由。行程方案可用 `GET /recommendations/:id` 读取。当前 C 方案保存输入快照、归属和有效期。过期返回 `410 PROPOSAL_EXPIRED`，草稿输入与方案不匹配返回 `409 PROPOSAL_INPUT_MISMATCH`，有未安排景点返回 `422 UNASSIGNED_PLACES`。前两种情况需重新生成，最后一种需调整天数或景点后重新生成。
- 如接入 B 的方案服务，先对齐 C 的 `ProposalReader.getOwnedProposal(id, userId)`。双方一起验证正常确认、他人方案、过期方案和输入变化。先核对目录表、方案表及迁移顺序，再接入共享数据库。

## 5. D 如何接足迹与手账

复用 C 的认证、城市 ID 和景点 ID。建议 D 保存实际到访时间和记录归属，行程 ID 可作为可选关联。创建或确认行程代表计划，城市点亮由 D 的实际到访记录产生。双方先明确删除行程后如何保留到访及媒体记录。D 的访问权限、上传、可见性和删除规则由 D 模块定义。

## 6. 合并前一起验收

1. A/C 用正式宿主页面完成登录、创建、确认、编辑、刷新读取，验证旧版本保存时的提示。
2. B/C 用同一组城市及景点 ID 验证目录、推荐和方案确认，并用两名用户验证方案归属。真实高德单独记录验证结果。
3. C/D 验证登录身份一致，计划行程不会自动产生到访，删除行程不会误删独立足迹。
4. 团队用空库及已有数据的库核对迁移顺序。涉及字段或接口变更时，同一改动更新共享类型、调用方和联调用例。

分享克隆、成员邀请与权限、WebSocket 同步需单独确定负责人和契约后排期。
