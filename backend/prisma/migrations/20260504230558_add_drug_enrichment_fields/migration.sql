-- Drug-name enrichment fields on PatientMedication. Both nullable so existing
-- rows stay valid and no backfill is needed. Populated by the new
-- DrugEnrichmentService for freeform meds (where matchToCatalog returns null);
-- catalog-tapped meds keep using their hardcoded `purpose` and brand icon and
-- never have these fields written.

ALTER TABLE "PatientMedication"
  ADD COLUMN "pillImageUrl" TEXT,
  ADD COLUMN "plainLanguageDescription" TEXT;
