# B 全面验收与开源模型复现

本轮按 B 开发计划逐项验收，证据在 [本轮目录](acceptance/B-20261102-full/README.md)。命令原始输出、每个 HTTP 请求与响应、模型 prompt/原始回复、失败修复记录、截图和校验摘要一起保存。历史验收目录保持原样。

## 1. 真实依赖与验收边界

数据库使用用户服务器 Docker 中的 PostgreSQL 17.11。模型新增同一服务器 Docker 中的 Ollama 0.13.5 + Qwen2.5-0.5B Q4_K_M，运行真实 CPU 推理，没有接收费模型或使用来源不明的 API Key。模型原始摘要为 `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`；本轮下载体积约 398 MB，镜像摘要见服务器日志。

模型容器只映射服务器 `127.0.0.1:11434`，限制 1700 MiB 内存、1.5 个 CPU，单并发、最多加载一个模型。数据库和模型都通过 SSH 转发到本地开发后端，没有使用本机 Docker。小模型用于验证接入与约束，不代表旅游知识正确或推荐质量达到生产要求。

模型来源及许可证：[Qwen 官方模型卡（Apache 2.0）](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF)、[Ollama 模型标签](https://ollama.com/library/qwen2.5:0.5b)。[Ollama 官方兼容接口说明](https://docs.ollama.com/api/openai-compatibility)明确本地服务忽略 API Key，因此 `ollama-local` 只是配置占位，不是第三方密钥。

地图已经调研开源替代：[OSRM/FOSSGIS](https://routing.openstreetmap.de/about.html)提供步行、骑行、驾车路线，并要求最多每秒一次、署名和适度使用；[Nominatim](https://nominatim.org/release-docs/latest/api/Reverse/)使用 WGS84 逆地理编码，其[公共服务政策](https://operations.osmfoundation.org/policies/nominatim/)还限制调用频率、用途和客户端身份。它们不能直接提供本项目原定的高德 GCJ-02 三交通模式、区县行政代码和 GPS 转换契约。本轮没有向这些公共服务发送批量测试，也没有把它们的结果伪装成高德结果。

高德适配器使用真实 HTTP 测试服务器验证请求参数、响应解析、三交通模式、超时与降级；无 Key 场景运行真实 B 算法。**高德正式账号权限、公交实际结果、地址与耗时数据仍未实测，不能标记为正式服务通过。** C 的真实登录、A/C 确认保存、D 页面与到访也属于后续联合验收。

## 2. 功能与证据对应

| B 功能                   | 验证内容                                                                                 | 证据                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 模块与身份边界           | 六接口匿名/伪造身份拒绝；测试装配注入两用户；生产入口不接受测试 token                    | 快速测试、`AUTH-*`、生产 HTTP smoke                         |
| 城市目录                 | 省/市、父级、关键词、分页总数、空页                                                      | `CAT-01`、`VALID-Q-*`、真库集成                             |
| 景点目录                 | 单城市、类别、主题稳定排序、先筛选后分页、中文搜索、SQL 注入字符串按字面量处理           | `CAT-02`、`CAT-03`、真库集成                                |
| 地点/城市内部服务        | 批量选择顺序、未知/跨城、明确行政区映射与公交 citycode                                   | 快速测试、`VALID-CROSS-CITY`、`MAP-*`、真库集成             |
| 参数与错误               | 日期、闰日、30/31 天、120/121 景点、主题/枚举、未知字段、坐标系、分页、多值查询          | 快速测试、`VALID-*`、`PLAN-120`                             |
| 规则排程                 | 三节奏、日数量上限、交通/休息、恰好预算/多一分钟、首站、空日、不可安排项、完整性、确定性 | 快速测试与新增边界测试、`PLAN-OVERFLOW`                     |
| 规模/资源控制            | 120 景点 × 30 天；交通调用上限；有向边缓存；总生成截止时间                               | 边界测试、`PLAN-120`、调用预算测试                          |
| 高德路线与解析           | 步行/驾车/公交、2701 秒向上取整、公交城市编码、HTTP/业务/JSON/耗时/慢响应错误            | `MAP-*`、`map-contract-evidence.json`（可控服务）           |
| 逆地理编码/GPS           | 区县映射、空城市数组、不支持城市为 null、真实解析转换响应                                | `MAP-REVERSE`、`MAP-UNKNOWN-CITY`、`MAP-GPS`（可控服务）    |
| 无 Key 降级              | 近距离步行 estimate、远距离/驾车/公交 503、可改日分开安排、信息不足不冒充预算不足        | 快速测试、`PLAN-NO-KEY`、`LLM-REAL-NO-KEY`                  |
| 数据迁移/种子            | 原基础库向前升级、重复迁移与 seed、保留人工景点、事务错误整体回滚、外键与级联            | 真库集成、`SEED-ATOMIC`                                     |
| 方案持久化               | 保存输入快照与到期时间、两用户、未知/他人 404、重启应用重读、返回值隔离、正式 trips 仍空 | `PLAN-OWNERSHIP`、`PLAN-RESTART`、真库集成                  |
| 失败不写入               | 非法输入不发地图请求/不插入；真实 SQL 触发插入异常不留半条数据；500 不泄漏 SQL           | `VALID-PLAN-*`、`PLAN-DB-FAIL`                              |
| 模型结构与回退           | 关闭时无请求；漏项/重复/编造/拒绝/截断/超时回退；合法候选重排且有改进才采用              | 模型快速测试、首轮实际失败记录                              |
| 真实 prompt 和回复       | 中文资料输入返回文本；B 真实结构化 prompt 返回完整原 ID 排列；方案真实落库               | `LLM-REAL-PROMPT`、`LLM-REAL-B`、`real-model-evidence.json` |
| 不使用地图替身的模型链路 | 真实模型 + B 无 Key 路线估算/改日 + 真实数据库保存重读                                   | `LLM-REAL-NO-KEY`                                           |

这些是可执行场景覆盖，不是数学意义上证明所有输入都不会出错。原始 Postman 示例仍等待 C 真实 token；自动验收覆盖对应业务行为，未声称已使用正式登录执行整个 Postman Collection。

## 3. 重现命令

在服务器部署模型（已执行，不需重复新建容器）：

```bash
OLLAMA_IMAGE=mirror.ccs.tencentyun.com/ollama/ollama:0.13.5 bash setup.sh
# setup.sh 来自 scripts/remote-llm/setup.sh。官方默认镜像为 ollama/ollama:0.13.5。
```

在本地工程根目录开启数据库与模型的 SSH 隧道，保持终端打开：

```powershell
npm run services:tunnel:b
```

本地 `.env` 模型配置如下。此文件不进入 Git 或验收压缩包；已有数据库连接保留。

```dotenv
B_LLM_ENABLED=true
LLM_API_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5:0.5b
LLM_API_KEY=ollama-local
B_LLM_TIMEOUT_MS=45000
B_GENERATION_TIMEOUT_MS=60000
```

`B_LLM_TIMEOUT_MS` 允许 1–60000 毫秒，默认 15000；地图仍使用 `B_EXTERNAL_TIMEOUT_MS`，两者都受总生成截止时间约束。当前 2 核服务器模型三景点结构化输出可能超过 15 秒，故本地配置为 45 秒。正式环境仍需测量容量和延迟。

另开终端执行完整验收，新目录不可覆盖既有 `run.json`：

```powershell
npm run acceptance:b -- --real-model --output docs/acceptance/B-新的时间或编号
```

验收依次执行版本、lint、typecheck、build、快速测试、迁移状态、原真库集成、全面 HTTP/数据库/真实模型场景、格式和差异检查、临时生产 API 的健康与拒绝认证检查。实际命令与退出码保存到 `commands.ps1`、`run.json` 和逐命令 `.txt`。只复测扩展场景可用：

```powershell
npm run build --workspace=@travel/api
$env:B_ACCEPTANCE_OUTPUT='docs/acceptance/B-单独扩展测试'
$env:B_ACCEPT_REAL_LLM='true'
node apps/api/scripts/acceptance/full-b.cjs
```

脚本仅在 `TEST_DATABASE_URL` 的专用 `_test` 库创建随机 schema；测试结束清理自己的 schema。测试身份只存在于该进程，脚本从不导入生产 AppModule。运行中的正式 API 仍需 C 接入认证后才能成功调用业务接口。

## 4. 本轮实际发现与修复

1. 第一次真实 B 模型请求只返回两景点。已有完整性校验正确回退，但模型请求缺少数组长度约束。补上与选择数量相等的 `minItems/maxItems`，并在 prompt 明确完整选择 ID 和每项仅一次。
2. 约束补齐后 CPU 推理超过原共用的 15 秒超时。新增独立 `B_LLM_TIMEOUT_MS`，保留全局生成截止时间；没有取消模型校验，也没有将超时当成功。模型调用证据现在也会记录超时类型。
3. 原验收脚本没有扩展 HTTP/数据库业务矩阵，且同目录可覆盖。新增全面场景并接入一键验收，拒绝覆盖已有 `run.json`；输出证据不参与格式改写。

前两次失败的请求和结果保留在本轮 `attempts/01`、`attempts/02`；`attempts/03` 为修复后预检。最终验收以本轮根目录日志与结果为准。所有截图均拍摄真实验收报告页面，原始命令行输出另外保存，未制作虚构终端画面。
