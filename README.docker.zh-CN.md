# 漫游旅行助手：Docker 本地运行包

此包用于把当前源码构建成 Docker 镜像，并在 Windows、macOS 或 Linux 本机运行。首次启动需要联网下载容器基础镜像和 npm 依赖。

## Windows 用户

1. 安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，确认 Docker 引擎已就绪。
2. 解压本压缩包。
3. 在解压目录右键“使用 PowerShell 运行” `启动漫游Docker.ps1`。如果系统策略阻止脚本，可在 PowerShell 中进入目录后运行 `powershell -ExecutionPolicy Bypass -File .\启动漫游Docker.ps1`。
4. 等构建完成后打开 <http://localhost:3000>。
5. 首次启动创建的管理员邮箱和随机密码可用 `docker compose logs app` 查看。请登录后立即修改密码。

## macOS / Linux

安装 Docker Engine 和 Compose 插件，在解压目录运行：

```sh
cp .env.docker.example .env
docker compose up -d --build
docker compose logs app
```

然后打开 <http://localhost:3000>。

## 日常管理

```sh
docker compose logs -f app   # 查看日志
docker compose stop          # 暂停服务
docker compose start         # 再次启动
docker compose down          # 停止并移除容器，保留数据
```

数据库及上传文件保存在解压目录下的 `data/` 和 `uploads/`，不要删除它们；建议定期备份。`.env` 保存本机配置，不要发送给他人或提交到代码仓库。要彻底卸载，可先备份数据，再手动删除上述数据目录。

## 常见问题

- **Docker 命令不存在/引擎未运行**：安装并启动 Docker Desktop，再重试。
- **3000 端口被占用**：编辑 `.env`，将 `HOST_PORT=3000` 改成其他空闲端口，例如 `HOST_PORT=3005`，再执行 `docker compose up -d`；访问对应端口。
- **构建失败或下载超时**：检查网络和 Docker Desktop 的代理设置，然后重试 `docker compose build --no-cache`。
- **页面打不开**：等待容器健康检查，执行 `docker compose ps` 和 `docker compose logs app` 查看状态与错误。
- **忘记管理员密码**：请联系软件维护者按项目提供的管理员恢复流程重置；不要删除 `data/`，否则会丢失本机数据。

本包默认只绑定本机访问，不提供公网部署配置。公网访问需要另行配置 HTTPS、反向代理和访问控制。
