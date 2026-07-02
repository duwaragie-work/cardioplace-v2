-- AlterTable
ALTER TABLE "AccessLog" ADD COLUMN     "systemActorLabel" TEXT;

-- AlterTable
ALTER TABLE "DeviationAlert" ADD COLUMN     "createdByActorId" TEXT,
ADD COLUMN     "updatedByActorId" TEXT;

-- AlterTable
ALTER TABLE "PatientProviderAssignment" ADD COLUMN     "createdByActorId" TEXT,
ADD COLUMN     "updatedByActorId" TEXT;

-- AlterTable
ALTER TABLE "PatientThreshold" ADD COLUMN     "createdByActorId" TEXT,
ADD COLUMN     "updatedByActorId" TEXT;
