DROP INDEX "facts_entity_metric_year_uniq";--> statement-breakpoint
DROP INDEX "facts_metric_year_idx";--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "subgroup" varchar(128) DEFAULT 'All Students' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "facts_entity_metric_year_subgroup_uniq" ON "facts" USING btree ("entity_id","metric_id","school_year","subgroup");--> statement-breakpoint
CREATE INDEX "facts_metric_year_subgroup_idx" ON "facts" USING btree ("metric_id","school_year","subgroup");