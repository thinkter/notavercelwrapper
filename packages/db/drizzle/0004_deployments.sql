CREATE TABLE "deployments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "repo_url" text NOT NULL,
  "runtime" varchar(32) NOT NULL,
  "branch" varchar(128),
  "install_command" text NOT NULL,
  "build_command" text,
  "start_command" text NOT NULL,
  "app_port" integer NOT NULL,
  "env_vars" jsonb,
  "assigned_worker_id" uuid,
  "host_port" integer,
  "public_url" text,
  "image_tag" text,
  "container_id" text,
  "commit_sha" varchar(64),
  "build_logs" text,
  "runtime_logs" text,
  "error_message" text,
  "assigned_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_assigned_worker_id_workers_id_fk" FOREIGN KEY ("assigned_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;
