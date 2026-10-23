$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error '未检测到 Docker。请先安装并启动 Docker Desktop，然后重新运行本脚本。'
}

try {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is unavailable.' }
} catch {
  Write-Error 'Docker Desktop 尚未启动。请启动 Docker Desktop，等待引擎就绪后重试。'
}

if (-not (Test-Path '.env')) {
  Copy-Item '.env.docker.example' '.env'
  Write-Host '已创建本地 .env 配置。'
}

if (-not (Select-String -Path '.env' -Pattern '^COMPOSE_PROJECT_NAME\s*=' -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path '.env' -Value "`nCOMPOSE_PROJECT_NAME=manyou"
}

Write-Host '正在构建并启动漫游旅行助手（首次启动需要下载依赖，可能需要几分钟）...'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Docker 构建或启动失败。可运行 docker compose logs app 查看原因。'
}

$port = 3000
$envLine = Get-Content '.env' | Where-Object { $_ -match '^HOST_PORT\s*=' } | Select-Object -Last 1
if ($envLine -match '^HOST_PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
Write-Host "应用已启动：http://localhost:$port"
Write-Host '首次登录管理员账号和随机密码：运行 docker compose logs app'
Write-Host '停止服务：docker compose down（数据保存在 data 和 uploads 目录）'
