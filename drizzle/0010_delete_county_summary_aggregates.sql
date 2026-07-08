-- Custom SQL migration file, put your code below! --
-- Second county-rollup encoding: the "county summary" form "0000NN000000"
-- (e.g. "000001000000" = "ALBANY County"), which the BEDS Day Enrollment file
-- uses. These were misclassified as districts (migration 0009 only caught the
-- "NN0000000000" form). Real districts carry a non-zero district number, so
-- none are caught. facts cascade on delete.
DELETE FROM "entities" WHERE "beds_code" ~ '^0000[0-9]{2}0{6}$';