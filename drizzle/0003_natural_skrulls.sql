ALTER TABLE "metrics" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "embedding_model" varchar(128);--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "embedding_hash" varchar(64);