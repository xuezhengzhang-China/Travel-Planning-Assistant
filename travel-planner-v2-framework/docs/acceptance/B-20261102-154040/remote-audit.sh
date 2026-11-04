#!/bin/sh
set -eu
printf 'COMMAND: date -Iseconds\n'
date -Iseconds
printf '\nCOMMAND: docker server version\n'
sudo -n docker version --format '{{.Server.Version}}'
printf '\nCOMMAND: docker compose version\n'
sudo -n docker compose version --short
printf '\nCOMMAND: docker ps --filter label=com.docker.compose.project=tpa-b-db\n'
sudo -n docker ps --filter label=com.docker.compose.project=tpa-b-db --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
printf '\nCOMMAND: docker inspect --format Health.Status tpa-b-db-postgres-1\n'
sudo -n docker inspect --format '{{.State.Health.Status}}' tpa-b-db-postgres-1
printf '\nCOMMAND: PostgreSQL version and development directory counts\n'
sudo -n docker exec tpa-b-db-postgres-1 psql -U travel_planner -d travel_planner -c 'SHOW server_version; SELECT count(*) AS destinations FROM destinations; SELECT count(*) AS places FROM places;'
printf '\nCOMMAND: list development and dedicated test databases\n'
sudo -n docker exec tpa-b-db-postgres-1 psql -U travel_planner -d postgres -c "SELECT datname FROM pg_database WHERE datname IN ('travel_planner','travel_planner_b_test') ORDER BY datname;"
printf '\nREMOTE AUDIT EXIT: 0\n'
