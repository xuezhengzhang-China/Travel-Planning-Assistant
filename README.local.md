# 本地开发

本项目基于 [T-T](https://github.com/bhxnms/T-T)，采用 AGPL-3.0。中文界面和 `Asia/Shanghai` 时区已设为本地默认值。

## 启动

在项目根目录运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 <http://localhost:5173/>。Vite 将 API 请求代理到本地服务 `http://localhost:3001`。

## 首次登录

本地演示管理员账号由 `.env` 与 `server/.env` 配置。首次登录按 T-T 的安全流程设置一个新密码；请勿提交这两个环境文件。账号与数据库保存在 `server/data/travel.db`，环境配置在被 Git 忽略的 `.env` 和 `server/.env` 中。

旧版漫游 MVP 代码和数据库保存在被 Git 忽略的 `_legacy-mvp/` 目录。

