-- Custom SQL migration file, put your code below! --
-- Remove county rollup entities that older data payloads mislabeled as
-- districts: a 2-digit NYSED county prefix followed by all zeros (e.g.
-- "580000000000"). These aggregate a whole county and aren't a real district —
-- county is a filter dimension in the app, not an entity. Real districts carry a
-- non-zero district number, so none are caught by this pattern.
-- facts.entity_id has ON DELETE CASCADE, so their aggregate facts go with them.
-- Future ingests skip these (ingest classifier) and load-data.sh's reconcile
-- step re-applies this delete post-load.
DELETE FROM "entities" WHERE "beds_code" ~ '^[0-9]{2}0{10}$';