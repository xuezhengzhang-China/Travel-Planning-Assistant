# Travel Planning Assistant

旅行规划助手的完整工程位于 `travel-planner-v2-framework/`，全软件 TDD 测试位于 `APP_Test/`。

2026-11-21 起，GitHub 分支按功能模块组织。`main` 汇总完整代码；本轮以 `integration-2` 的 `60e714b` 为整合来源，通过正常合并保留原 `main` 历史。功能分支保留完整工程，后续提交围绕各自模块展开。

| 分支                           | 用途                                 |
| ------------------------------ | ------------------------------------ |
| `main`                         | 完整整合版本                         |
| `feature/home-navigation`      | 首页、导航与页面外壳                 |
| `feature/auth-profile`         | 注册登录、认证、个人资料             |
| `feature/places-catalog`       | 城市、景点目录、搜索与数据           |
| `feature/smart-recommendation` | 智能推荐、模型建议、规则排程与方案   |
| `feature/routes-transport`     | 路线、公交指引、逆地理和坐标适配     |
| `feature/trip-management`      | 草稿、行程保存、日程编辑、版本与确认 |
| `feature/footprints-map`       | 实际到访、足迹、行政区地图和城市点亮 |
| `feature/journals-media`       | 图文手账、附件、上传、授权读取与清理 |
| `feature/luggage-reminders`    | 行李清单、出行与购票提醒             |
| `test`                         | 全软件测试、回归、联调和真实验收材料 |
| `meeting-records`              | 会议纪要、决策和行动项               |

现有的 `integration`、`integration-2`、成员姓名分支及 `week-8/zhaofutao` 全部保留；本轮没有删除或重写这些分支。

完整的模块路径、共享文件规则及起点记录见 [分支结构与协作约定](docs/branches/分支结构与协作约定.md)。日常 Git 命令见 [分支操作指南](GitHub分支操作指南.md)，会议记录使用 [会议记录模板](docs/meetings/会议记录模板.md)。

项目启动说明见 [工程 README](travel-planner-v2-framework/README.md)，测试代码与使用方法见 [测试 README](APP_Test/README.md)。分支整理只同步已有整合版本，不表示新增功能开发完成或全软件测试已经通过。
