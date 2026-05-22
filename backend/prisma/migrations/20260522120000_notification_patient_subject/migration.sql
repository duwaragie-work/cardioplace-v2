-- Care-team notices that aren't alert-linked (IVR-04 enrollment-paused /
-- condition-review) need a "subject patient" pointer so the admin bell /
-- notifications page can deep-link to /patients/{patientUserId}. Nullable:
-- existing + alert-linked rows leave it null.
ALTER TABLE "Notification" ADD COLUMN "patientUserId" TEXT;
