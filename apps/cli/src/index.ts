export {};

type Primitive = string | number | boolean;

type JobMetadata = Record<string, Primitive>;

type CreateJobPayload = {
  runtime: string;
  sourceUrl: string;
  entryCommand: string;
  timeoutSeconds?: number;
  exposedPort?: number;
  metadata?: JobMetadata;
};

type CreateDeploymentPayload = {
  repoUrl: string;
  runtime: "python" | "typescript";
  branch?: string;
  installCommand: string;
  buildCommand?: string;
  startCommand: string;
  appPort: number;
  envVars?: Record<string, string>;
};

const API_URL = process.env.CLIRCEL_API_URL ?? "http://localhost:3001";

function printHelp() {
  console.log(`clircel CLI

Usage:
  bun run cli -- health
  bun run cli -- workers:list
  bun run cli -- jobs:list
  bun run cli -- jobs:create --runtime node --source-url https://example.com/repo.tar.gz --entry-command "npm start"
  bun run cli -- jobs:create --runtime node --source-url https://example.com/repo.tar.gz --entry-command "npm test" --timeout-seconds 300
  bun run cli -- jobs:create --runtime node --source-url https://example.com/repo.tar.gz --entry-command "npm start" --port 3000 --metadata '{"commit":"abc123"}'
  bun run cli -- deployments:list
  bun run cli -- deployments:get --id <deployment-id>
  bun run cli -- deployments:create --repo-url https://github.com/org/repo.git --runtime typescript --install-command "npm install" --build-command "npm run build" --start-command "npm run start" --app-port 3000

Environment:
  CLIRCEL_API_URL   Base URL for the API. Defaults to http://localhost:3001
`);
}

function getFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function requireFlag(args: string[], flag: string) {
  const value = getFlagValue(args, flag);

  if (!value) {
    throw new Error(`Missing required flag: ${flag}`);
  }

  return value;
}

function parseMetadata(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--metadata must be a JSON object");
  }

  return parsed as JobMetadata;
}

function parseStringMap(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }

  for (const value of Object.values(parsed)) {
    if (typeof value !== "string") {
      throw new Error("All env var values must be strings");
    }
  }

  return parsed as Record<string, string>;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, API_URL), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

async function createJob(args: string[]) {
  const payload: CreateJobPayload = {
    runtime: requireFlag(args, "--runtime"),
    sourceUrl: requireFlag(args, "--source-url"),
    entryCommand: requireFlag(args, "--entry-command"),
  };

  const port = getFlagValue(args, "--port");
  if (port) {
    payload.exposedPort = Number(port);
  }

  const timeoutSeconds = getFlagValue(args, "--timeout-seconds");
  if (timeoutSeconds) {
    payload.timeoutSeconds = Number(timeoutSeconds);
  }

  payload.metadata = parseMetadata(getFlagValue(args, "--metadata"));

  await request("/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function createDeployment(args: string[]) {
  const payload: CreateDeploymentPayload = {
    repoUrl: requireFlag(args, "--repo-url"),
    runtime: requireFlag(args, "--runtime") as CreateDeploymentPayload["runtime"],
    installCommand: requireFlag(args, "--install-command"),
    buildCommand: getFlagValue(args, "--build-command"),
    startCommand: requireFlag(args, "--start-command"),
    appPort: Number(requireFlag(args, "--app-port")),
  };

  const branch = getFlagValue(args, "--branch");
  if (branch) {
    payload.branch = branch;
  }

  payload.envVars = parseStringMap(getFlagValue(args, "--env-vars"));

  await request("/deployments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function main() {
  const [command, ...args] = Bun.argv.slice(2);

  switch (command) {
    case "health":
      await request("/health", { method: "GET" });
      return;
    case "workers:list":
      await request("/workers", { method: "GET" });
      return;
    case "jobs:list":
      await request("/jobs", { method: "GET" });
      return;
    case "jobs:create":
      await createJob(args);
      return;
    case "deployments:list":
      await request("/deployments", { method: "GET" });
      return;
    case "deployments:get":
      await request(`/deployments/${requireFlag(args, "--id")}`, { method: "GET" });
      return;
    case "deployments:create":
      await createDeployment(args);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

await main();
