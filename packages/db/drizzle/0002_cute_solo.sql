ALTER TABLE "jobs" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "log_output" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "current_job_id" uuid;