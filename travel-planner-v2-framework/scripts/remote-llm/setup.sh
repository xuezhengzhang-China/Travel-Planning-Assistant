#!/usr/bin/env bash
set -euo pipefail
# Run on the Ubuntu server. No local Docker or paid API key is required.
# Image mirror override is optional; the deployed acceptance instance uses Tencent's mirror.
image="${OLLAMA_IMAGE:-ollama/ollama:0.13.5}"
name=tpa-b-ollama
sudo -n docker pull "$image"
if sudo -n docker container inspect "$name" >/dev/null 2>&1; then
  actual=$(sudo -n docker inspect --format '{{.Config.Image}}' "$name")
  if [ "$actual" != "$image" ]; then
    echo 'Existing model container uses a different image; leaving it unchanged.' >&2
    exit 1
  fi
  sudo -n docker start "$name"
else
  sudo -n docker run -d --name "$name" --restart unless-stopped \
    --memory 1700m --cpus 1.5 \
    -e OLLAMA_NUM_PARALLEL=1 -e OLLAMA_MAX_LOADED_MODELS=1 \
    -p 127.0.0.1:11434:11434 -v tpa-b-ollama-data:/root/.ollama "$image"
fi
sudo -n docker exec "$name" ollama pull qwen2.5:0.5b
sudo -n docker exec "$name" ollama list
