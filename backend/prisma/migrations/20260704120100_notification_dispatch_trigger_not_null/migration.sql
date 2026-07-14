-- Enforce NOT NULL on Notification.dispatchTrigger. Split from the enum-convert
-- migration on purpose: by the time this runs, the code that sets an explicit
-- dispatchTrigger on EVERY dispatch path is already deployed, so no in-flight
-- insert can violate the constraint. The DB now guarantees every future
-- notification declares why it was sent — a dispatcher can never again silently
-- produce a null-trigger row that the bell filter can't classify.
-- The prior migration backfilled all existing rows, so no row is null here.
ALTER TABLE "Notification" ALTER COLUMN "dispatchTrigger" SET NOT NULL;
