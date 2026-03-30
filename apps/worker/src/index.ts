export {};

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { z } from "zod";

const envSchema = z.object({
  WORKER_API_URL: z.string().url(),
  WORKER_NAME: z.string().min(1),
  WORKER_CLOUD: z.string().default("aws"),
  WORKER_REGION: z.string().min(1),
  WORKER_INSTANCE_ID: z.string().min(1).default("local-dev"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_ROOT_DIR: z.string().default(".worker-runs"),
  WORKER_PUBLIC_HOST: z.string().min(1).optional(),
  WORKER_PUBLIC_SCHEME: z.enum(["http", "https"]).default("http"),
  WORKER_PUBLIC_BASE_PATH: z.string().default("/deployments"),
  WORKER_PROXY_PROVIDER: z.enum(["none", "nginx"]).default("none"),
  WORKER_NGINX_CONFIG_DIR: z.string().default("/etc/nginx/conf.d/clircel"),
});

const env = envSchema.parse(process.env);

const claimDeploymentResponseSchema = z.object({
  ok: z.literal(true),
  deployment: z
    .object({
      id: z.string().uuid(),
      repo_url: z.string().url(),
      runtime: z.enum(["python", "typescript"]),
      branch: z.string().nullable().optional(),
      install_command: z.string(),
      build_command: z.string().nullable().optional(),
      start_command: z.string(),
      app_port: z.number().int().positive(),
      env_vars: z.record(z.string(), z.string()).nullable().optional(),
    })
    .nullable(),
});

type ClaimedDeployment = z.infer<typeof claimDeploymentResponseSchema>["deployment"];

let workerId: string | null = null;
let currentDeploymentId: string | null = null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, env.WORKER_API_URL), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data as T;
}

async function registerWorker() {
  const response = await api<{
    ok: true;
    worker: { id: string };
  }>("/workers/register", {
    method: "POST",
    body: JSON.stringify({
      name: env.WORKER_NAME,
      cloud: env.WORKER_CLOUD,
      region: env.WORKER_REGION,
      instanceId: env.WORKER_INSTANCE_ID,
    }),
  });

  workerId = response.worker.id;
  console.log(`Registered worker ${env.WORKER_NAME} as ${workerId}`);
}

async function heartbeat(state: "idle" | "busy" | "offline") {
  if (!workerId) {
    return;
  }

  await api(`/workers/${workerId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({
      state,
      currentJobId: currentDeploymentId,
    }),
  });
}

async function claimDeployment() {
  if (!workerId) {
    return null;
  }

  const response = await api<z.infer<typeof claimDeploymentResponseSchema>>(
    `/workers/${workerId}/claim-deployment`,
    {
      method: "POST",
    },
  );

  return claimDeploymentResponseSchema.parse(response).deployment;
}

async function updateDeploymentStatus(
  deploymentId: string,
  status: "building" | "starting" | "running" | "failed" | "stopped",
  payload?: {
    hostPort?: number;
    publicUrl?: string;
    imageTag?: string;
    containerId?: string;
    commitSha?: string;
    buildLogs?: string;
    runtimeLogs?: string;
    errorMessage?: string;
  },
) {
  if (!workerId) {
    return;
  }

  await api(`/workers/${workerId}/deployments/${deploymentId}/status`, {
    method: "POST",
    body: JSON.stringify({
      status,
      ...payload,
    }),
  });
}

async function runCommand(command: string, cwd: string) {
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim(),
  };
}

async function runCommandStreaming(
  command: string,
  cwd: string,
  onUpdate?: (output: string) => Promise<void>,
) {
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let output = "";
  let lastSentOutput = "";
  let lastUpdateAt = 0;

  const maybeUpdate = async (force = false) => {
    if (!onUpdate) {
      return;
    }

    const now = Date.now();
    if (!force && output === lastSentOutput) {
      return;
    }

    if (!force && now - lastUpdateAt < 1000) {
      return;
    }

    lastSentOutput = output;
    lastUpdateAt = now;
    await onUpdate(output.trim());
  };

  const collectStream = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) {
      return;
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        output += decoder.decode(value, { stream: true });
        await maybeUpdate();
      }

      output += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  };

  await Promise.all([collectStream(proc.stdout), collectStream(proc.stderr), proc.exited]);
  await maybeUpdate(true);

  return {
    exitCode: await proc.exited,
    output: output.trim(),
  };
}

async function stageSource(sourceUrl: string, workdir: string, branch?: string | null) {
  const sourceDir = join(workdir, "source");
  await mkdir(sourceDir, { recursive: true });
  const parsedUrl = new URL(sourceUrl);
  const pathname = parsedUrl.pathname;
  const branchArg = branch ? ` --branch ${JSON.stringify(branch)}` : "";

  if (sourceUrl.endsWith(".git")) {
    const cloneResult = await runCommand(
      `git clone --depth 1${branchArg} ${JSON.stringify(sourceUrl)} ${JSON.stringify(sourceDir)}`,
      workdir,
    );

    if (cloneResult.exitCode !== 0) {
      throw new Error(`git clone failed: ${cloneResult.output}`);
    }

    return sourceDir;
  }

  const githubRepoMatch = pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (parsedUrl.hostname === "github.com" && githubRepoMatch) {
    const cloneUrl = `https://github.com/${githubRepoMatch[1]}/${githubRepoMatch[2]}.git`;
    const cloneResult = await runCommand(
      `git clone --depth 1${branchArg} ${JSON.stringify(cloneUrl)} ${JSON.stringify(sourceDir)}`,
      workdir,
    );

    if (cloneResult.exitCode !== 0) {
      throw new Error(`git clone failed: ${cloneResult.output}`);
    }

    return sourceDir;
  }

  const archiveName = basename(pathname) || "source.tar.gz";
  const archivePath = join(workdir, archiveName);
  const download = await fetch(sourceUrl);

  if (!download.ok) {
    throw new Error(`Failed to download source: ${download.status}`);
  }

  const contentType = download.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "Source URL returned HTML instead of a repository/archive. Use a .git URL or a direct archive download URL.",
    );
  }

  await Bun.write(archivePath, await download.arrayBuffer());

  if (archivePath.endsWith(".zip")) {
    const unzipResult = await runCommand(
      `unzip -q ${JSON.stringify(archivePath)} -d ${JSON.stringify(sourceDir)}`,
      workdir,
    );

    if (unzipResult.exitCode !== 0) {
      throw new Error(`unzip failed: ${unzipResult.output}`);
    }
  } else if (
    archivePath.endsWith(".tar") ||
    archivePath.endsWith(".tar.gz") ||
    archivePath.endsWith(".tgz")
  ) {
    const untarResult = await runCommand(
      `tar -xf ${JSON.stringify(archivePath)} -C ${JSON.stringify(sourceDir)}`,
      workdir,
    );

    if (untarResult.exitCode !== 0) {
      throw new Error(`tar extract failed: ${untarResult.output}`);
    }
  } else {
    throw new Error(
      "Unsupported source URL. Use a Git repository URL, .zip, .tar, .tar.gz, or .tgz archive.",
    );
  }

  const entries = Array.from(new Bun.Glob("*").scanSync({ cwd: sourceDir }));
  if (entries.length === 1) {
    return join(sourceDir, entries[0]!);
  }

  return sourceDir;
}

function runtimeImage(runtime: "python" | "typescript") {
  switch (runtime) {
    case "python":
      return "python:3.12-bookworm";
    case "typescript":
      return "node:20-bookworm";
  }
}

function dockerfileForDeployment(deployment: NonNullable<ClaimedDeployment>) {
  const runLines = [
    `RUN ${deployment.install_command}`,
    deployment.build_command?.trim() ? `RUN ${deployment.build_command}` : null,
  ].filter((line): line is string => Boolean(line));

  return [
    `FROM ${runtimeImage(deployment.runtime)}`,
    "WORKDIR /workspace",
    "COPY . .",
    ...runLines,
    `EXPOSE ${deployment.app_port}`,
    `CMD ["bash", "-lc", ${JSON.stringify(deployment.start_command)}]`,
    "",
  ].join("\n");
}

async function getCommitSha(sourceDir: string) {
  const result = await runCommand("git rev-parse HEAD", sourceDir);
  return result.exitCode === 0 ? result.output.trim() : undefined;
}

async function allocateHostPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate host port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForPort(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = new Socket();

      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(1000);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
      socket.connect(port, "127.0.0.1");
    });

    if (reachable) {
      return;
    }

    await Bun.sleep(1000);
  }

  throw new Error(`Timed out waiting for deployment port ${port} to become reachable`);
}

function deploymentPublicUrl(deploymentId: string) {
  if (!env.WORKER_PUBLIC_HOST) {
    return undefined;
  }

  const basePath = env.WORKER_PUBLIC_BASE_PATH.replace(/\/+$/, "");
  return `${env.WORKER_PUBLIC_SCHEME}://${env.WORKER_PUBLIC_HOST}${basePath}/${deploymentId}/`;
}

function nginxConfigForDeployment(deploymentId: string, hostPort: number) {
  const locationPath = `${env.WORKER_PUBLIC_BASE_PATH.replace(/\/+$/, "")}/${deploymentId}`;

  return [
    `location = ${locationPath} {`,
    `  return 308 ${locationPath}/;`,
    "}",
    "",
    `location ${locationPath}/ {`,
    `  proxy_pass http://127.0.0.1:${hostPort}/;`,
    "  proxy_http_version 1.1;",
    "  proxy_set_header Host $host;",
    "  proxy_set_header X-Real-IP $remote_addr;",
    "  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "  proxy_set_header X-Forwarded-Proto $scheme;",
    "  proxy_redirect off;",
    "}",
    "",
  ].join("\n");
}

async function publishDeploymentRoute(deploymentId: string, hostPort: number, cwd: string) {
  if (env.WORKER_PROXY_PROVIDER !== "nginx") {
    return deploymentPublicUrl(deploymentId);
  }

  await mkdir(env.WORKER_NGINX_CONFIG_DIR, { recursive: true });
  const configPath = join(env.WORKER_NGINX_CONFIG_DIR, `${deploymentId}.conf`);
  await Bun.write(configPath, nginxConfigForDeployment(deploymentId, hostPort));

  const validateResult = await runCommand("nginx -t", cwd);
  if (validateResult.exitCode !== 0) {
    throw new Error(`nginx config validation failed: ${validateResult.output}`);
  }

  const reloadResult = await runCommand("systemctl reload nginx", cwd);
  if (reloadResult.exitCode !== 0) {
    throw new Error(`nginx reload failed: ${reloadResult.output}`);
  }

  return deploymentPublicUrl(deploymentId);
}

function envArgs(envVars: Record<string, string> | null | undefined) {
  if (!envVars) {
    return "";
  }

  return Object.entries(envVars)
    .map(([key, value]) => ` -e ${JSON.stringify(`${key}=${value}`)}`)
    .join("");
}

async function removeContainer(containerName: string, cwd: string) {
  await runCommand(`docker rm -f ${JSON.stringify(containerName)}`, cwd);
}

async function dockerLogs(containerName: string, cwd: string) {
  const result = await runCommand(`docker logs ${JSON.stringify(containerName)}`, cwd);
  return result.output;
}

async function executeDeployment(deployment: NonNullable<ClaimedDeployment>) {
  await mkdir(env.WORKER_ROOT_DIR, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "clircel-deployment-"));
  const artifactDir = join(env.WORKER_ROOT_DIR, deployment.id);
  const imageTag = `clircel-deployment-${deployment.id}`;
  const containerName = `clircel-deployment-${deployment.id}`;

  let hostPort: number | undefined;
  let containerId: string | undefined;

  try {
    const sourceDir = await stageSource(deployment.repo_url, tempDir, deployment.branch);
    const commitSha = await getCommitSha(sourceDir);

    await mkdir(artifactDir, { recursive: true });
    await Bun.write(join(artifactDir, "deployment.json"), JSON.stringify(deployment, null, 2));

    const dockerfilePath = join(sourceDir, ".clircel.Dockerfile");
    await Bun.write(dockerfilePath, dockerfileForDeployment(deployment));

    await updateDeploymentStatus(deployment.id, "building", {
      imageTag,
      commitSha,
      buildLogs: "Build started...",
    });

    const buildResult = await runCommandStreaming(
      `docker build -f ${JSON.stringify(dockerfilePath)} -t ${JSON.stringify(imageTag)} ${JSON.stringify(sourceDir)}`,
      sourceDir,
      async (output) => {
        await updateDeploymentStatus(deployment.id, "building", {
          imageTag,
          commitSha,
          buildLogs: output.length > 0 ? output : "Build started...",
        });
      },
    );

    await Bun.write(join(artifactDir, "build.log"), buildResult.output);

    if (buildResult.exitCode !== 0) {
      await updateDeploymentStatus(deployment.id, "failed", {
        imageTag,
        commitSha,
        buildLogs: buildResult.output,
        errorMessage: `Docker build failed with code ${buildResult.exitCode}`,
      });
      return;
    }

    hostPort = await allocateHostPort();
    await updateDeploymentStatus(deployment.id, "starting", {
      hostPort,
      imageTag,
      commitSha,
      buildLogs: buildResult.output,
    });

    const runResult = await runCommand(
      [
        "docker run -d",
        `--name ${JSON.stringify(containerName)}`,
        `-p ${hostPort}:${deployment.app_port}`,
        envArgs(deployment.env_vars),
        JSON.stringify(imageTag),
      ].join(" "),
      sourceDir,
    );

    if (runResult.exitCode !== 0) {
      await updateDeploymentStatus(deployment.id, "failed", {
        hostPort,
        imageTag,
        commitSha,
        buildLogs: buildResult.output,
        runtimeLogs: runResult.output,
        errorMessage: `Docker run failed with code ${runResult.exitCode}`,
      });
      return;
    }

    containerId = runResult.output.trim();
    await waitForPort(hostPort, 60_000);

    const runtimeLogs = await dockerLogs(containerName, sourceDir);
    const publicUrl = await publishDeploymentRoute(deployment.id, hostPort, sourceDir);

    await Bun.write(join(artifactDir, "runtime.log"), runtimeLogs);
    await updateDeploymentStatus(deployment.id, "running", {
      hostPort,
      publicUrl,
      imageTag,
      containerId,
      commitSha,
      buildLogs: buildResult.output,
      runtimeLogs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const runtimeLogs =
      containerId || hostPort ? await dockerLogs(containerName, tempDir).catch(() => "") : "";

    await updateDeploymentStatus(deployment.id, "failed", {
      hostPort,
      publicUrl: hostPort ? deploymentPublicUrl(deployment.id) : undefined,
      imageTag,
      containerId,
      runtimeLogs,
      errorMessage: message,
    });

    console.error(`Deployment ${deployment.id} failed`, error);

    if (containerId || hostPort) {
      await removeContainer(containerName, tempDir).catch(() => {});
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function loop() {
  while (true) {
    try {
      await heartbeat(currentDeploymentId ? "busy" : "idle");

      if (!currentDeploymentId) {
        const deployment = await claimDeployment();

        if (deployment) {
          currentDeploymentId = deployment.id;
          console.log(`Claimed deployment ${deployment.id}`);

          try {
            await executeDeployment(deployment);
          } finally {
            currentDeploymentId = null;
          }
        }
      }
    } catch (error) {
      console.error("Worker loop error", error);
    }

    await Bun.sleep(env.WORKER_POLL_INTERVAL_MS);
  }
}

async function shutdown() {
  try {
    await heartbeat("offline");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await registerWorker();
await heartbeat("idle");
await loop();
