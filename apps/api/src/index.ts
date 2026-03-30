import { cors } from "@elysiajs/cors";
import { db } from "@clircel/db";
import { deployments, jobs, workers } from "@clircel/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { z } from "zod";

import { env } from "./env";

const createJobSchema = z.object({
  runtime: z.string().min(1),
  sourceUrl: z.string().min(1),
  entryCommand: z.string().min(1),
  timeoutSeconds: z.number().int().positive().max(3600).default(600),
  exposedPort: z.number().int().positive().max(65535).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const createDeploymentSchema = z.object({
  repoUrl: z.string().url(),
  runtime: z.enum(["python", "typescript"]),
  branch: z.string().min(1).max(128).optional(),
  installCommand: z.string().min(1),
  buildCommand: z.string().optional().default(""),
  startCommand: z.string().min(1),
  appPort: z.number().int().positive().max(65535),
  envVars: z.record(z.string(), z.string()).optional(),
});

const registerWorkerSchema = z.object({
  name: z.string().min(1),
  cloud: z.string().min(1).default("aws"),
  region: z.string().min(1),
  instanceId: z.string().min(1).optional(),
});

const heartbeatSchema = z.object({
  state: z.enum(["idle", "busy", "offline"]).default("idle"),
  currentJobId: z.string().uuid().nullable().optional(),
});

const updateJobStatusSchema = z.object({
  status: z.enum(["running", "succeeded", "failed"]),
  logOutput: z.string().optional(),
  errorMessage: z.string().optional(),
});

const updateDeploymentStatusSchema = z.object({
  status: z.enum(["building", "starting", "running", "failed", "stopped"]),
  hostPort: z.number().int().positive().max(65535).optional(),
  publicUrl: z.string().url().optional(),
  imageTag: z.string().optional(),
  containerId: z.string().optional(),
  commitSha: z.string().optional(),
  buildLogs: z.string().optional(),
  runtimeLogs: z.string().optional(),
  errorMessage: z.string().optional(),
});

const app = new Elysia()
  .use(cors())
  .get("/health", () => ({
    ok: true,
    service: "api",
    timestamp: new Date().toISOString(),
  }))
  .get("/workers", async () => {
    return db.select().from(workers).orderBy(desc(workers.createdAt)).limit(25);
  })
  .get("/jobs", async () => {
    return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(25);
  })
  .get("/deployments", async () => {
    return db
      .select()
      .from(deployments)
      .orderBy(desc(deployments.createdAt))
      .limit(25);
  })
  .get("/deployments/:id", async ({ params, set }) => {
    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, params.id))
      .limit(1);

    if (!deployment) {
      set.status = 404;

      return {
        ok: false,
        message: "Deployment not found",
      };
    }

    return {
      ok: true,
      deployment,
    };
  })
  .post("/jobs", async ({ body, set }) => {
    const parsed = createJobSchema.safeParse(body);

    if (!parsed.success) {
      set.status = 400;

      return {
        ok: false,
        message: "Invalid job payload",
        issues: parsed.error.flatten(),
      };
    }

    const [job] = await db
      .insert(jobs)
      .values({
        runtime: parsed.data.runtime,
        sourceUrl: parsed.data.sourceUrl,
        entryCommand: parsed.data.entryCommand,
        timeoutSeconds: parsed.data.timeoutSeconds,
        exposedPort: parsed.data.exposedPort,
        metadata: parsed.data.metadata,
      })
      .returning();

    set.status = 201;

    return {
      ok: true,
      job,
    };
  })
  .post("/deployments", async ({ body, set }) => {
    const parsed = createDeploymentSchema.safeParse(body);

    if (!parsed.success) {
      set.status = 400;

      return {
        ok: false,
        message: "Invalid deployment payload",
        issues: parsed.error.flatten(),
      };
    }

    const [deployment] = await db
      .insert(deployments)
      .values({
        repoUrl: parsed.data.repoUrl,
        runtime: parsed.data.runtime,
        branch: parsed.data.branch,
        installCommand: parsed.data.installCommand,
        buildCommand: parsed.data.buildCommand,
        startCommand: parsed.data.startCommand,
        appPort: parsed.data.appPort,
        envVars: parsed.data.envVars,
      })
      .returning();

    set.status = 201;

    return {
      ok: true,
      deployment,
    };
  })
  .post("/workers/register", async ({ body, set }) => {
    const parsed = registerWorkerSchema.safeParse(body);

    if (!parsed.success) {
      set.status = 400;

      return {
        ok: false,
        message: "Invalid worker payload",
        issues: parsed.error.flatten(),
      };
    }

    const existingWorker =
      parsed.data.instanceId
        ? (
            await db
              .select({ id: workers.id })
              .from(workers)
              .where(eq(workers.instanceId, parsed.data.instanceId))
              .limit(1)
          )[0]
        : undefined;

    let worker;

    if (existingWorker) {
      [worker] = await db
        .update(workers)
        .set({
          name: parsed.data.name,
          cloud: parsed.data.cloud,
          region: parsed.data.region,
          state: "idle",
          currentJobId: null,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workers.id, existingWorker.id))
        .returning();
    } else {
      [worker] = await db
        .insert(workers)
        .values({
          name: parsed.data.name,
          cloud: parsed.data.cloud,
          region: parsed.data.region,
          instanceId: parsed.data.instanceId,
          state: "idle",
          currentJobId: null,
          lastHeartbeatAt: new Date(),
        })
        .returning();
    }

    set.status = 201;

    return {
      ok: true,
      worker,
    };
  })
  .post("/workers/:id/heartbeat", async ({ body, params, set }) => {
    const parsed = heartbeatSchema.safeParse(body);

    if (!parsed.success) {
      set.status = 400;

      return {
        ok: false,
        message: "Invalid heartbeat payload",
        issues: parsed.error.flatten(),
      };
    }

    const [worker] = await db
      .update(workers)
      .set({
        state: parsed.data.state,
        currentJobId: parsed.data.currentJobId ?? null,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workers.id, params.id))
      .returning();

    if (!worker) {
      set.status = 404;

      return {
        ok: false,
        message: "Worker not found",
      };
    }

    return {
      ok: true,
      worker,
    };
  })
  .post("/workers/:id/claim-job", async ({ params }) => {
    const claimed = await db.execute(sql`
      with next_job as (
        select id
        from jobs
        where status = 'queued'
          and assigned_worker_id is null
        order by created_at asc
        limit 1
      )
      update jobs
      set
        status = 'assigned',
        assigned_worker_id = ${params.id}::uuid,
        assigned_at = now(),
        updated_at = now()
      where id in (select id from next_job)
      returning *
    `);

    const job = claimed.rows[0] ?? null;

    if (!job) {
      return {
        ok: true,
        job: null,
      };
    }

    await db
      .update(workers)
      .set({
        state: "busy",
        currentJobId: String(job.id),
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workers.id, params.id));

    return {
      ok: true,
      job,
    };
  })
  .post("/workers/:id/claim-deployment", async ({ params }) => {
    const claimed = await db.execute(sql`
      with next_deployment as (
        select id
        from deployments
        where status = 'queued'
          and assigned_worker_id is null
        order by created_at asc
        limit 1
      )
      update deployments
      set
        status = 'building',
        assigned_worker_id = ${params.id}::uuid,
        assigned_at = now(),
        updated_at = now()
      where id in (select id from next_deployment)
      returning *
    `);

    const deployment = claimed.rows[0] ?? null;

    if (!deployment) {
      return {
        ok: true,
        deployment: null,
      };
    }

    await db
      .update(workers)
      .set({
        state: "busy",
        currentJobId: String(deployment.id),
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workers.id, params.id));

    return {
      ok: true,
      deployment,
    };
  })
  .post("/workers/:id/jobs/:jobId/status", async ({ body, params, set }) => {
    const parsed = updateJobStatusSchema.safeParse(body);

    if (!parsed.success) {
      set.status = 400;

      return {
        ok: false,
        message: "Invalid job status payload",
        issues: parsed.error.flatten(),
      };
    }

    const updateValues: Partial<typeof jobs.$inferInsert> = {
      status: parsed.data.status,
      updatedAt: new Date(),
      logOutput: parsed.data.logOutput,
      errorMessage: parsed.data.errorMessage,
    };

    if (parsed.data.status === "running") {
      updateValues.startedAt = new Date();
    }

    if (parsed.data.status === "succeeded" || parsed.data.status === "failed") {
      updateValues.finishedAt = new Date();
    }

    const [job] = await db
      .update(jobs)
      .set(updateValues)
      .where(eq(jobs.id, params.jobId))
      .returning();

    if (!job) {
      set.status = 404;

      return {
        ok: false,
        message: "Job not found",
      };
    }

    if (parsed.data.status === "succeeded" || parsed.data.status === "failed") {
      await db
        .update(workers)
        .set({
          state: "idle",
          currentJobId: null,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workers.id, params.id));
    }

    return {
      ok: true,
      job,
    };
  })
  .post(
    "/workers/:id/deployments/:deploymentId/status",
    async ({ body, params, set }) => {
      const parsed = updateDeploymentStatusSchema.safeParse(body);

      if (!parsed.success) {
        set.status = 400;

        return {
          ok: false,
          message: "Invalid deployment status payload",
          issues: parsed.error.flatten(),
        };
      }

      const updateValues: Partial<typeof deployments.$inferInsert> = {
        status: parsed.data.status,
        hostPort: parsed.data.hostPort,
        publicUrl: parsed.data.publicUrl,
        imageTag: parsed.data.imageTag,
        containerId: parsed.data.containerId,
        commitSha: parsed.data.commitSha,
        buildLogs: parsed.data.buildLogs,
        runtimeLogs: parsed.data.runtimeLogs,
        errorMessage: parsed.data.errorMessage,
        updatedAt: new Date(),
      };

      if (parsed.data.status === "starting" || parsed.data.status === "running") {
        updateValues.startedAt = new Date();
      }

      if (parsed.data.status === "failed" || parsed.data.status === "stopped") {
        updateValues.finishedAt = new Date();
      }

      const [deployment] = await db
        .update(deployments)
        .set(updateValues)
        .where(eq(deployments.id, params.deploymentId))
        .returning();

      if (!deployment) {
        set.status = 404;

        return {
          ok: false,
          message: "Deployment not found",
        };
      }

      if (parsed.data.status === "running" || parsed.data.status === "failed") {
        await db
          .update(workers)
          .set({
            state: parsed.data.status === "running" ? "idle" : "idle",
            currentJobId: null,
            lastHeartbeatAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(workers.id, params.id));
      }

      return {
        ok: true,
        deployment,
      };
    },
  )
  .listen({
    hostname: env.API_HOST,
    port: env.API_PORT,
  });

console.log(
  `API listening on http://${app.server?.hostname ?? env.API_HOST}:${app.server?.port ?? env.API_PORT}`,
);
