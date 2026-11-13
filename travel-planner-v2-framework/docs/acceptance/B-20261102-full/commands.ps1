# Run in the project root. Keep npm run db:tunnel:b active in another terminal.
Set-Location 'F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework'
node --version
npm --version
npm run lint
npm run typecheck
npm run build
npm run test
npm run db:migrate:status
npm run test:integration:b
$env:B_ACCEPTANCE_OUTPUT='F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework\docs\acceptance\B-20261102-full'; $env:B_ACCEPT_REAL_LLM='true'; node apps/api/scripts/acceptance/full-b.cjs
npm run format:check
git -c core.autocrlf=false diff --check
# HTTP smoke uses a temporary API at port 3031, started and stopped by the acceptance runner.
node apps/api/scripts/acceptance/http-smoke.cjs http://127.0.0.1:3031/api "F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework\docs\acceptance\B-20261102-full\http-results.json"
