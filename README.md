# Clircel Monorepo

This repo is now split into a small monorepo so you can build the hackathon control plane without mixing the frontend, API, and database code together.

## Apps

- `apps/web`: Next.js 16 frontend
- `apps/api`: Elysia API running on Bun
- `apps/cli`: Bun CLI for local automation and GitHub Actions
- `apps/worker`: Node.js worker agent that polls the API and executes jobs
- `packages/db`: Drizzle schema and CockroachDB client

## Run It

Install dependencies with Bun:

```bash
bun install
```

Start the frontend:

```bash
bun run dev:web
```

The web app intentionally runs Next through `node` with `--webpack` to avoid Bun/Turbopack instability during local development.

Start the API:

```bash
cp apps/api/.env.example apps/api/.env
bun run dev:api
```

Start a local worker:

```bash
cp apps/worker/.env.example apps/worker/.env
bun run --cwd apps/worker --env-file .env start
```

Run the CLI:

```bash
bun run cli -- help
```

Generate and push Drizzle schema changes:

```bash
bun run db:generate
bun run db:migrate
```

You can also run Drizzle directly from the repo root:

```bash
bunx drizzle-kit generate
bunx drizzle-kit push
```

The DB scripts automatically load `apps/api/.env`, so keep `DATABASE_URL` there and the API plus migration commands will stay in sync. The web app also needs its own auth variables in `apps/web/.env.local`; copy from `apps/web/.env.example` and point both apps at the same CockroachDB cluster. Shell environment variables still win over file-based values.

If you change the workers or jobs schema, rerun:

```bash
bun run db:generate
bun run db:migrate
```

## CLI

The CLI talks to the API and is intended for automation flows such as GitHub Actions.

Example commands:

```bash
bun run cli -- health
bun run cli -- workers:list
bun run cli -- jobs:list
bun run cli -- jobs:create --runtime node --source-url https://example.com/repo.tar.gz --entry-command "npm start"
bun run cli -- jobs:create --runtime node --source-url https://example.com/repo.tar.gz --entry-command "npm test" --timeout-seconds 300
```

Set the API URL with:

```bash
export CLIRCEL_API_URL=http://localhost:3001
```

## Worker Flow

- `POST /workers/register`: creates a worker record
- `POST /workers/:id/heartbeat`: updates worker state and liveness
- `POST /workers/:id/claim-job`: claims the next queued job
- `POST /workers/:workerId/jobs/:jobId/status`: marks the job running, succeeded, or failed

The current worker supports:

- Git repositories ending in `.git`
- Downloaded `.zip` or tar archives
- `node` jobs via Docker image `node:20-bookworm`
- `python` jobs via Docker image `python:3.12-bookworm`

## AWS Workers

The Terraform in `infra/aws` can now do two levels of setup:

- base mode: create EC2 workers with Docker and supporting tools
- full mode: clone your repo, build the worker Docker image, and run `apps/worker` in Docker under `systemd`

To enable full mode, set these in `infra/aws/terraform.tfvars` before applying:

```hcl
worker_api_url  = "https://your-api-url"
worker_repo_url = "https://github.com/your-org/your-repo.git"
worker_repo_ref = "main"
```

Then replace the instances:

```bash
cd infra/aws
terraform apply \
  -replace='aws_instance.workers[0]' \
  -replace='aws_instance.workers[1]'
```

## Hackathon Notes

- Keep the warm-worker scheduler in the API, not in the Next app.
- Do not add Redis until the database-backed lease flow is actually working.
- Auth is handled in `apps/web` with Better Auth, GitHub OAuth, Drizzle, and CockroachDB.
- User workloads should still run on workers, not inside this API service.
