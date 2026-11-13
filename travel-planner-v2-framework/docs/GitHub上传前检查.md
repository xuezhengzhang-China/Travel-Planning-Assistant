# GitHub上传前检查（2026-11-02）

结论：适合提交到独立分支并创建PR供团队评审。本次未执行git add、commit、push，也没有改动远程仓库。

## 已验证

- 前后端构建、全部工作区类型检查、全量ESLint通过。
- 后端31项、前端20项测试通过，统一npm test已包含两者。
- 真实数据库保存/重启/读取、两用户权限、事务回滚、同版本并发与删除验证通过。
- 独立临时数据库的全量迁移、旧数据升级、回滚和再次升级通过。
- .env、node_modules、dist与视频解码缓存均被Git忽略。对全部待提交文件进行常见凭据、实际本地密钥文本及大文件扫描，未发现命中；此为本次扫描结果，不代表完整安全审计。
- 查询时远程main与本地HEAD一致：cfbd3f0e7568d0069750d7653ef2f5cf1fe17d12。后续其他人仍可能提交，合并前需要重新同步。

## 本次修正

- CI从子目录迁到仓库根目录.github/workflows/travel-planner-v2.yml，使用正确工作目录及lockfile路径，增加前端测试和真实数据库验证。
- 增加前端test脚本，根npm test统一运行两组测试。
- Prettier配置endOfLine:auto，修复Windows CRLF误报，并格式化实际不一致文件。
- README标明当前名称、完成状态、分工和接入入口，保留旧架构作为历史背景。
- Vite开发启动强制刷新共享CJS预编译，避免旧缓存导致白屏；生产构建不启用该选项。

GitHub Actions工作流尚未在GitHub实际执行，需推送后查看结果；本地已运行对应构建、测试和数据库检查。

## 上传范围

从Git仓库根目录上传根.github/workflows/travel-planner-v2.yml以及整个travel-planner-v2-framework变更。不要只传前端：必须同时包含共享引擎、类型、目录快照、全部增量迁移、后端和说明。

目前大量业务文件为未跟踪状态，不能只提交已跟踪文件的修改。不要用git add -f强制加入.env或依赖缓存。

推荐在仓库根目录使用新分支：

```powershell
git switch -c codex/suixin-trip-integration
git add .github/workflows/travel-planner-v2.yml travel-planner-v2-framework
git diff --cached --stat
git commit -m "feat: add Suixinxing trip planning and persistence"
git push -u origin codex/suixin-trip-integration
```

提交后创建PR交给团队评审，共享模块与分工变更应一并确认；请勿强推main。

## 交付边界

补充功能复查：已修复外部直达行程失败时，错误提示可能被列表刷新清空的问题；打开和列表请求分别保留错误，增加直达入口重试，并暂停打开期间的重复列表请求。独立浏览器测试验证加载失败提示保留，模拟服务恢复后点击重试可重新进入编辑。未使用真实账号和数据库，临时测试页已移除。构建、类型、lint、格式及31+20项测试均通过。

该版本可以用于本地联调；真实地图仍缺Key和核实坐标，自动排程使用明确标注的估算交通。视频前端只完成组件适配与测试宿主验证，尚未合并对方真实源码。上传GitHub不包含本地账号和数据库业务记录，也不会自动部署到服务器。
