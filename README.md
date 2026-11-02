# Travel-Planning-Assistant

## V1 版本

前端阶段成果及配套项目框架统一存放在 [Travel-Planning-Assistant-V1](./Travel-Planning-Assistant-V1/) 文件夹。

包含行程规划、全国目的地选择、出行提醒、天气行李清单、足迹地图及旅行手账。
行程、足迹和手账目前保存在各自浏览器中，不会跨设备同步。

### 本地运行

需要 Node.js 22.12 或更高版本。在仓库根目录执行：

```powershell
cd Travel-Planning-Assistant-V1
npm ci
npm run dev:web
```

打开终端显示的本地网址。停止服务按 Ctrl + C。

### 目录说明

- `Travel-Planning-Assistant-V1/apps/web`：V1 前端源码、静态数据与测试。
- `Travel-Planning-Assistant-V1/apps/api`：配套 API 框架。
- `Travel-Planning-Assistant-V1/packages`：共享模块。
- `Travel-Planning-Assistant-V1/docs`：项目文档。
- `.github`：GitHub 自动化配置，保留在仓库根目录。
