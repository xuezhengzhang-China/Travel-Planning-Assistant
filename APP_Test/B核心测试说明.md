# B 模块 TDD 测试：代码架构与使用说明

本文件夹集中保存本轮 B 模块的测试代码、用例清单、运行脚本和[测试计划](测试计划.md)，可以整体复制或交给其他开发者。

编写日期：2026-11-17；目录整理日期：2026-11-18。**当前状态：已编写、未执行。** 本次只移动文件、补充文档并做静态检查，没有运行测试，也没有测得初始 0% 或最终 100%。下文的安装、构建、SSH 和测试命令均供后续执行。

## 1. 文件夹结构

```text
B_TDD_Test/
├── README.md                         # 架构、配置、测试步骤与结果解释
├── 测试计划.md                       # 测试范围、方法、T0—T8 开发安排
├── package.json                      # 本文件夹自己的 npm 测试入口
├── .env.example                      # 测试库配置模板，不含真实凭据
├── .gitignore                        # 忽略私有配置与生成的报告
├── cases/
│   └── tdd-core.v1.json               # 冻结的 100 个逻辑用例及需求对应关系
├── scripts/
│   ├── tdd-run.cjs                    # 环境检查、启动测试、保存阶段证据
│   └── tdd-reporter.cjs               # 按冻结清单统计并输出逐项结果
├── tests/tdd/
│   ├── core.test.cjs                  # 统一注册清单中的全部用例
│   ├── validation.cases.cjs           # V：输入校验
│   ├── catalog.cases.cjs              # C：地点目录与真实 SQL
│   ├── planner.cases.cjs              # P：规则排程
│   ├── proposals.cases.cjs            # S：方案、迁移与持久化
│   ├── geo.cases.cjs                  # R/G：路线、地理和降级
│   ├── model.cases.cjs                # M：模型适配、重排与回退
│   ├── http.cases.cjs                 # H：HTTP 契约与身份边界
│   └── support/
│       ├── context.cjs               # 装配真实被测模块、依赖替身与测试资源
│       └── fixtures.cjs              # 固定城市、景点、用户、时钟和节奏契约
└── reports/tdd/                      # 以后实际执行时才创建
    └── <UTC时间戳>-<阶段>-<进程号>/
```

业务源码不放在这个文件夹里。测试通过显式指定的目标工程，加载其 `apps/api/dist/` 中的真实 B 模块；不会默认选取上级目录的 `.subject` 参考代码。

## 2. 测试代码如何协作

```mermaid
flowchart TD
    A["npm test：显式指定目标工程与阶段"] --> B["tdd-run.cjs：检查依赖、构建与接口骨架"]
    B --> C["core.test.cjs：核对并注册冻结的 100 个用例"]
    D["tdd-core.v1.json：固定编号、标题、数量与方法"] --> C
    C --> E["七个 cases.cjs：输入、调用与断言"]
    E --> F["context.cjs + fixtures.cjs：装配和固定数据"]
    F --> G["目标工程的真实业务模块"]
    F --> H["服务器 PostgreSQL 专用测试库"]
    F --> I["本地可控 HTTP 地图/模型服务"]
    C --> J["tdd-reporter.cjs：逐项统计"]
    J --> K["reports/tdd：控制台、JSON、阶段 Markdown"]
```

- **清单层**：`tdd-core.v1.json` 保存唯一编号、标题、阶段、依赖、方法及文件路径。分母固定为 100，一个用例内多条断言或多组数据仍只算一项。
- **用例层**：各 `*.cases.cjs` 导出“编号 → 标题与测试函数”。`core.test.cjs` 检查编号、标题、文件和数量是否一致，再交给 Node.js 内置的 `node:test` 执行。
- **支撑层**：`fixtures.cjs` 独立定义预期契约；`context.cjs` 加载实际被测模块，装配固定时钟、内存仓库、真实 NestJS 应用、本地 HTTP 服务和数据库隔离。依赖替身用于隔离外部条件，不负责实现待验证的排程或 SQL 行为。
- **执行与报告层**：`tdd-run.cjs` 检查目标与阶段，顺序执行完整集合，保存版本、清单/测试文件/部分构建产物的 SHA-256；`tdd-reporter.cjs` 区分通过、业务失败、阻塞和未执行。

单个逻辑用例默认超时 30 秒；HTTP 服务使用本机随机端口并在用例结束后关闭，无需预先启动前端或 API。测试文件为 CommonJS `.cjs`，测试框架使用 Node.js 内置模块；NestJS、PostgreSQL 驱动等从目标工程自身的依赖中加载。

## 3. 测试哪些内容、采用什么方法

| 编号 | 数量 | 对应文件 | 验证重点与方法 |
| --- | ---: | --- | --- |
| V01—V20 | 20 | `validation.cases.cjs` | 日期、UUID、数量、枚举、坐标、分页；等价类、边界值、表驱动 |
| C01—C12 | 12 | `catalog.cases.cjs` | 城市/景点筛选、排序、分页、归属和 SQL 特殊输入；真实 PostgreSQL 集成 |
| P01—P22 | 22 | `planner.cases.cjs` | 三种节奏、时间预算、完整性、确定性；决策表、独立不变量断言、固定种子组合 |
| S01—S12 | 12 | `proposals.cases.cjs` | 迁移、种子、快照、有效期、所有权、重启与事务；固定时钟、真实数据库、故障注入 |
| R01—R10 | 10 | `geo.cases.cjs` | 三交通方式、耗时、超时、缓存、调用预算与降级；实际适配器加可控 HTTP 响应 |
| G01—G06 | 6 | `geo.cases.cjs` | 逆地理、行政区映射与 GPS 转换；正常/异常响应矩阵 |
| M01—M10 | 10 | `model.cases.cjs` | 模型请求、严格输出、完整排列、重排采用与回退；结构矩阵、慢响应、故障注入 |
| H01—H08 | 8 | `http.cases.cjs` | 六接口、身份、错误结构与脱敏；真实 NestJS 和 HTTP 请求 |
| 合计 | **100** | `cases/tdd-core.v1.json` | 固定逻辑用例集合，当前尚未执行 |

需要真实数据库的 **21 项**：C01—C12，S01/S02/S08—S12，H01/H02。其余用例不要求测试库；完整验收仍必须包含这 21 项。

HTTP 覆盖以下六个接口：

```text
GET  /api/destinations
GET  /api/places
GET  /api/places/:id
POST /api/routes/preview
POST /api/locations/reverse
POST /api/recommendations/itinerary
```

正向 HTTP 用例中的 `tdd-a`、`tdd-b` 仅是测试装配内的身份；H07 验证默认生产身份配置会拒绝这些 token。地图和模型的核心测试使用本地可控服务，不需要真实高德 Key 或在线模型。真实模型的 prompt/回复验收、真实高德专项和 A/C/D 联合业务流程须另行执行，本集合的 100% 只代表约定的 B 核心范围。

## 4. 执行前需要准备什么

1. 安装 Node.js **22.12.0 或更高版本**及 npm。
2. 准备目标工程，路径应指向含 `apps/api`、`packages` 和根 `package.json` 的 `travel-planner-v2-framework` 层。
3. 在目标工程安装依赖并构建 API，保留 `apps/api/migrations` 和 `apps/api/scripts/seed-b.cjs`。迁移与种子使用目标版本自身的文件。
4. 准备服务器 Docker 中的 PostgreSQL 专用测试库，例如 `travel_planner_b_test`。连接账号须能在该库创建 schema 并执行迁移；不需要本机 Docker。

本测试文件夹没有额外 npm 依赖，不需要在这里运行 `npm install`。**需要安装的是被测工程的依赖**。例如，在未来实际执行前：

```powershell
# 按实际路径替换；此教学工程尚需自行准备。
$env:TPA_TDD_SUBJECT_ROOT = 'F:\TPA\独立TDD工程\travel-planner-v2-framework'
Set-Location $env:TPA_TDD_SUBJECT_ROOT
npm ci
npm run build --workspace=@travel/api
```

运行器要求校验函数、BModule、地点 Service/Repository、规则排程、推荐 Service/Repository、地图/地理和模型适配器等接口骨架能够正常导出；具体导出名称列在 `scripts/tdd-run.cjs` 的 `interfaces` 中。缺少文件、依赖或导出会先报环境错误，不能算有效业务 Red。

若按课程演示从 0% 开始，应选取尚无本轮业务逻辑、但接口骨架可构建和加载的独立教学版本。已有完整 B 实现的版本可能一开始就有用例通过，须保留真实结果。

## 5. 配置服务器测试库

按此前服务器的端口约定，若本机尚无隧道，在另一个终端建立 SSH 转发并保持终端开启：

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:55432:127.0.0.1:55432 -p 22 ubuntu@120.53.94.209
```

按 SSH 提示完成认证。服务器服务或端口变更时应同步调整连接配置。

在测试文件夹复制配置模板，并编辑其中的测试库用户名、密码和库名：

```powershell
Set-Location F:\TPA\Test_coding\B_TDD_Test
Copy-Item .env.example .env
# 用编辑器修改 .env 后，显式指定该文件。
$env:TPA_TDD_ENV_FILE = (Resolve-Path .env).Path
```

模板只包含以下格式的占位连接串，凭据中的特殊字符须按 URL 编码：

```dotenv
TEST_DATABASE_URL=postgresql://TEST_USER:REPLACE_WITH_YOUR_PASSWORD@127.0.0.1:55432/travel_planner_b_test
```

也可直接设置进程环境变量 `TEST_DATABASE_URL`；它优先于文件配置。`TPA_TDD_ENV_FILE` 指向的文件只读取 `TEST_DATABASE_URL`，不会读取其中的目标路径或模型配置，因此 `TPA_TDD_SUBJECT_ROOT` 仍须单独设置。

测试库必须已存在，库名仅允许小写字母、数字和下划线，并以 `_test` 结尾。每个真库用例创建独立随机 `tdd_*` schema，正常清理阶段只删除自己的 schema；进程被强制终止时可能留下该 schema。测试不会创建整个数据库。

## 6. 如何运行测试

确认目标路径、构建与测试库配置后，在本文件夹执行：

```powershell
Set-Location F:\TPA\Test_coding\B_TDD_Test
$env:TPA_TDD_SUBJECT_ROOT = 'F:\TPA\独立TDD工程\travel-planner-v2-framework'
$env:TPA_TDD_ENV_FILE = (Resolve-Path .env).Path
npm test -- --phase T0
# 查看退出码：
$LASTEXITCODE
```

也可用命令行参数传入目标：

```powershell
npm test -- --subject 'F:\TPA\独立TDD工程\travel-planner-v2-framework' --phase T0
```

目标不是 Git 工作目录时，额外传 `--revision` 记录真实来源标识，例如：

```powershell
npm test -- --subject 'F:\TPA\独立TDD工程\travel-planner-v2-framework' --phase T0 --revision '实际来源提交或版本标识'
```

在 `F:\TPA\Test_coding` 上级目录执行 `npm run test:tdd -- --phase T0` 也会转交此处入口；在上级目录直接执行 `npm test` 仍属于旧回归工程。

T0—T8 都运行同一完整集合。阶段参数只标记开发进度，不筛选用例，也不会把结果强制改成目标比例：

| 阶段 | 对应开发工作 |
| --- | --- |
| T0 | 测试先行版本与有效初始失败基线 |
| T1 | 输入校验与归一化 |
| T2 | 地点目录 |
| T3 | 规则排程 |
| T4 | 方案持久化 |
| T5 | 地图与地理服务 |
| T6 | 模型适配与建议处理 |
| T7 | 六接口、身份及错误契约收口 |
| T8 | 重构与回归 |

后续每轮按“修改业务代码 → 重新构建 API → 运行同一集合 → 保存本轮报告与提交”推进，例如 T1 使用 `npm test -- --phase T1`。若未重新构建，测试加载的仍可能是旧的 `dist`。T8 的旧回归、lint、类型检查和构建需按[测试计划](测试计划.md)另行完成，不包含在 100 项业务通过率内。

## 7. 报告在哪里、怎样判断结果

实际进入测试执行后，报告保存在本文件夹的 `reports/tdd/<UTC时间戳>-<阶段>-<进程号>/`：

| 文件 | 内容 |
| --- | --- |
| `execution.json` | 目标路径、来源版本、阶段、起止时间、测试/清单/构建哈希和子进程退出码 |
| `console.txt` | 本次测试子进程的控制台输出 |
| `core-results.json` | 每个逻辑用例的状态、原因、耗时及固定分母统计 |
| `阶段结果.md` | 可阅读的阶段结果与逐项用例表 |

前置环境检查失败时会在控制台报错并退出，可能尚未创建报告目录。本目录中的 `.gitignore` 默认忽略运行报告与 `.env`；需要作为课程证据交付时，另行审阅、归档并提交所需材料。

```text
核心通过率 = 实际通过的逻辑用例数 / 100 × 100%
```

| 退出码 | 含义与处理 |
| --- | --- |
| 0 | 完整核心集合全部通过；结合逐项结果确认适用版本 |
| 1 | 存在业务断言失败，修改对应业务实现后重新构建并复测 |
| 2 | 环境/工具问题，或存在阻塞、未执行；先修复配置与环境 |
| 3 | T0 实际已有通过项，需核对起始版本，保留真实结果 |

数据库未配置或连接不可用时，对应项记为阻塞，不计通过，也不会从分母移除。只有 `validMeasurement=true`，且全部 100 项都有有效业务结果，才适合比较开发阶段通过率；环境缺失不能作为初始 0% 的证据。用例内部若产生非标准子进程退出码，还应查看日志定位异常。

最终核心完成标准是 100/100 通过、失败/阻塞/未执行均为 0，并保留真实的测试先行提交、业务实现提交和各阶段报告。当前没有执行记录，不应将上级目录历史报告当成本集合的结果。

## 8. 添加或维护测试

先在对应 `*.cases.cjs` 编写“编号、中文标题、执行函数”，再同步更新 `cases/tdd-core.v1.json`。七个现有模块由 `core.test.cjs` 显式加载；新增第八个模块时，还需更新其模块列表和运行器的测试文件哈希清单。

本轮 v1 已冻结为 100 项。新增需求、修订契约或调整分母时，应记录新版本、原因及变化，不能静默删除失败项或只运行成功子集。修改测试与业务代码的提交顺序、阶段目标和联合验收范围，统一以本文件夹的[测试计划](测试计划.md)为准。
