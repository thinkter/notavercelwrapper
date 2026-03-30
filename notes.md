
  1. User submits code or a repo URL.
  2. Your API stores a job record in a DB/queue.
  3. A scheduler finds an idle warm worker.
  4. The scheduler leases that worker to the job.
  5. The worker downloads the user bundle/repo.
  6. The worker runs it inside Docker.
  7. The worker streams logs and reports status.
  8. When done, the worker is marked idle again.

  Instead:

  - provision 1-3 warm workers ahead of time
  - keep them running
  - run each job in a fresh Docker container on the worker

  That gives you:

  - fast demo
  - reasonable isolation
  - much less control-plane work

  Minimal Architecture

  You need only 5 moving parts:

  - api
      - receives job submissions
  - db
      - stores jobs, workers, leases
  - scheduler
      - picks an idle worker
  - worker-agent
      - long-running process on each VM
  - docker
      - actually runs user code

  For hackathon infra:

  - 1 AWS or GCP region
  - 1 VM image
  - 2 warm workers
  - 1 Postgres or even SQLite if you must
  - 1 object store bucket for uploaded code bundles


  Per job:

  - create temp work dir
  - unpack source
  - create container
  - mount work dir read-only if possible
  - expose a chosen internal port if needed
  - run install/build/start commands
  - capture stdout/stderr
  - enforce timeout


  
  1. Pick one cloud only.
      - If you already know AWS, use AWS.
      - If you already know GCP, use GCP.
      - Do not split attention.
  2. Provision 2 warm workers manually or with minimal Terraform.
      - One control/API server
      - Two worker VMs
  3. Build the DB tables.
      - jobs
      - workers
      - worker_leases optional
  4. Build worker registration + heartbeat.
  5. Build scheduler lease logic.
      - one queued job -> one idle worker
  6. Build artifact upload/download.
      - tarball to object storage
  7. Build worker runner with Docker.
      - unpack
      - run container
      - stream logs
      - timeout
      - cleanup
  8. Build status page / CLI output for demo.
      - queued
      - running
      - logs
      - success/failure
  9. Only after that, add automatic provisioning or autoscaling.


  
  bun install
  cp apps/api/.env.example apps/api/.env
  bun run dev:web
  bun run dev:api

  Then set DATABASE_URL and run:

  bun run db:generate
  bun run db:migrate




What To Measure


  - cold start time
  - warm start time
  - queue wait time
  - deployment success rate
  - worker utilization
  - job completion time
  - worker reuse rate
  - cost per job
  - time to first log
  - provisioning time


Best Hackathon Story

  You probably want to prove one claim:

  “Warm workers reduce startup latency while keeping costs reasonable.”

  So your headline metrics should be:

  - P50 warm start time
  - P95 warm start time
  - P50 cold start time
  - P95 cold start time
  - success rate
  - average cost per job or idle cost per hour

  That gives you a clean comparison.

  Example pitch:

  - cold start: 75s
  - warm start: 6s
  - success rate: 96%
  - idle pool cost: $X/hour

  That is much stronger than listing 10 features.

  For GitHub Actions, the pattern is straightforward:

  - uses: oven-sh/setup-bun@v2
  - run: bun install
  - run: bun run cli -- jobs:create --runtime node --source-url "$ARTIFACT_URL" --entry-command "npm start"
    env:
      CLIRCEL_API_URL: ${{ secrets.CLIRCEL_API_URL }}





• I set up a minimal AWS Terraform stack under infra/aws: infra/aws/main.tf, infra/aws/
  variables.tf, infra/aws/terraform.tfvars.example, and the EC2 bootstrap script infra/aws/
  user_data.sh.tftpl. It creates a VPC, one public subnet, an SSM-enabled instance role, and
  Terraform does not need separate auth. It just needs AWS credentials in your shell.
  Fastest hackathon path:

  1. In AWS Console, create or use an IAM user with credentials.
  2. Give it enough permissions to create EC2, VPC, IAM role/profile, and SSM resources.
     For hackathon speed, AdministratorAccess works, but it is broad.
  3. Export credentials locally:

  export AWS_ACCESS_KEY_ID="..."
  export AWS_SECRET_ACCESS_KEY="..."
  export AWS_DEFAULT_REGION="us-east-1"
  # only if AWS gave you one:
  export AWS_SESSION_TOKEN="..."

  Then deploy:

  cd /home/ashman/Documents/projects/notavercelwrapper/infra/aws
  cp terraform.tfvars.example terraform.tfvars
  terraform init
  terraform plan
  terraform apply

  After apply, check outputs:

  terraform output

 1. add a worker service in the monorepo
  2. add API routes for worker register / heartbeat / next-job
  3. make the worker run on the EC2 instances
  4. use the CLI to submit a job and watch a worker pick it up










   1. Lock The MVP Contract

  Define one deployment request shape and stick to it.

  Request payload:

  - repoUrl
  - runtime: python or typescript
  - installCommand
  - buildCommand
  - startCommand
  - port
  - optional branch
  - optional env

  Success output:

  - deploymentId
  - status
  - publicUrl

  Decide one routing model now:

  - https://<deployment-id>.yourdomain.com
  - or https://yourdomain.com/d/<deployment-id>

  Subdomain routing is cleaner.

  2. Reshape The Data Model

  Add a deployments table. Keep workers, but stop treating customer apps as one-shot
  jobs.

  deployments should store:

  - id
  - status: queued, building, starting, running, failed, stopped
  - repoUrl
  - runtime
  - installCommand
  - buildCommand
  - startCommand
  - appPort
  - assignedWorkerId
  - hostPort
  - publicUrl
  - containerId
  - branch
  - commitSha
  - buildLogs
  - errorMessage
  - createdAt
  - updatedAt

  Optional later:

  - ownerUserId
  - customDomain
  - lastHealthcheckAt

  3. Build The Control Plane API

  Add these endpoints in apps/api:

  - POST /deployments
      - validate payload
      - insert deployment row with queued
  - GET /deployments
  - GET /deployments/:id
  - POST /workers/:id/claim-deployment
      - claim next queued deployment
  - POST /workers/:id/deployments/:deploymentId/status
      - update status/logs/metadata
  - optional POST /deployments/:id/stop
  - optional POST /deployments/:id/redeploy

  Important rule:

  - claiming must be atomic in SQL
  - one worker should not pick the same deployment as another

  4. Rewrite Worker From Job Runner To Deployer

  This is the main backend work.

  Worker flow:

  1. claim queued deployment
  2. clone repo into temp dir
  3. checkout branch if provided
  4. write a Dockerfile or use runtime template
  5. build image
  6. allocate a free host port
  7. start container detached with docker run -d
  8. health-check the container on that port
  9. register reverse proxy route
  10. mark deployment running and save publicUrl

  On failure:

  - save logs
  - mark failed
  - cleanup temp files and failed container

  For MVP, the worker should support only:

  - python
  - typescript

  Do not auto-detect much. Use the commands supplied by the request.

  5. Add Public Routing On The Runner

  This is the missing piece today.

  Simplest approach:

  - run Nginx or Caddy on each EC2 worker
  - allocate one host port per app container
  - generate one vhost config per deployment
  - reload proxy after deploy succeeds

  Example:

  - app container listens on internal 3000
  - Docker maps 41023:3000
  - proxy maps abc123.yourdomain.com -> 127.0.0.1:41023

  You also need:

  - a wildcard DNS record pointing to the runner public IP or load balancer
  - TLS
  - one base domain you control

  For hackathon speed:

  - one runner with one public IP
  - one wildcard DNS record
  - Caddy is easier than raw Nginx if you want fast TLS setup
  - if you want AWS-native TLS/LB later, add ALB later, not now

  6. Fix Infra To Match The Runtime Model

  Current Terraform only makes generic workers. Extend it so the worker machine is
  also an app host.

  Add:

  - inbound 80 and 443
  - install Docker plus reverse proxy
  - wildcard DNS target plan
  - persistent directory for generated proxy configs
  - systemd service for the worker
  - maybe a small cleanup cron for old images/containers

  If using one runner initially:

  - worker_count = 1
  - expose 80/443
  - point *.yourdomain.com to that box

  7. Add Health And Cleanup

  Before calling a deployment successful:

  - poll http://127.0.0.1:<hostPort>/
  - or poll a configured health path
  - retry for 30-60 seconds

  Also add cleanup:

  - stop old container on redeploy
  - remove dead containers
  - prune unused images periodically
  - release host port on stop/failure

  8. Add Minimal Security Guardrails

  Do not skip this completely.

  At minimum:

  - only allow deployment from authenticated users
  - add worker auth token between worker and API
  - run containers with resource limits
  - disable privileged mode
  - add timeout on builds
  - cap log size
  - cap repo size

  Still not truly multi-tenant secure, but enough for MVP.

  9. Test In This Exact Order

  1. local API + local worker + local Docker
  2. deploy one sample TypeScript repo
  3. deploy one sample Python repo
  4. verify proxy route works locally
  5. move same flow to one EC2 box
  6. attach wildcard DNS
  7. test redeploy and stop
  8. then add frontend

  10. Recommended Implementation Order In This Repo

  1. add deployments schema and migration
  2. add API endpoints
  3. refactor worker claim/update flow from jobs to deployments
  4. implement Docker build/start logic
  5. implement host port allocation
  6. implement proxy config generation + reload
  7. update Terraform/bootstrap for public ingress
  8. test with one EC2 worker
  9. only then build the frontend deploy form

  What I Would Do First

  First concrete milestone:

  - POST /deployments
  - worker claims it
  - worker clones repo
  - worker builds and starts container
  - API shows running
  - publicUrl works on one EC2 machine

  That is the first real win. Everything else is iteration.

  If you want, I can turn this into a very concrete execution checklist against this
  repo’s files and start implementing phase 1 and 2.
