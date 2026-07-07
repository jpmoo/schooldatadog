-- Remove statewide / NRC aggregate ("state") entities and all their facts.
-- facts.entity_id has ON DELETE CASCADE, so associated facts go with them.
-- Future ingests skip these (ingest CLI) and the committed data payloads no
-- longer contain them, so a re-load won't bring them back.
DELETE FROM "entities" WHERE "type" = 'state';
