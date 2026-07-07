CREATE TYPE "public"."data_type" AS ENUM('numeric', 'percent', 'count', 'currency', 'ratio', 'categorical', 'text');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('school', 'district', 'state');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"beds_code" varchar(32),
	"name" varchar(512) NOT NULL,
	"type" "entity_type" NOT NULL,
	"parent_district_id" integer,
	"county" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_beds_code_unique" UNIQUE("beds_code")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"metric_id" integer NOT NULL,
	"school_year" varchar(16) NOT NULL,
	"value_numeric" double precision,
	"value_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(128),
	"data_type" "data_type" DEFAULT 'numeric' NOT NULL,
	"unit" varchar(64),
	"source" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(255),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_district_id_entities_id_fk" FOREIGN KEY ("parent_district_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_type_idx" ON "entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "entities_parent_idx" ON "entities" USING btree ("parent_district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_entity_metric_year_uniq" ON "facts" USING btree ("entity_id","metric_id","school_year");--> statement-breakpoint
CREATE INDEX "facts_metric_year_idx" ON "facts" USING btree ("metric_id","school_year");--> statement-breakpoint
CREATE INDEX "facts_entity_idx" ON "facts" USING btree ("entity_id");