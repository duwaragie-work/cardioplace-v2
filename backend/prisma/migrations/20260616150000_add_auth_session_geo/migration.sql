-- Geolocation anomaly audit (Manisha 2026-06-12 Doc 2 Q1).
-- Audit-only, no block.

ALTER TABLE "AuthSession" ADD COLUMN "geohash" TEXT;
ALTER TABLE "AuthSession" ADD COLUMN "ipCountry" TEXT;
