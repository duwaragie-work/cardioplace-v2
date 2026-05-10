-- AlterTable
ALTER TABLE "DeviationAlert" ADD COLUMN     "acknowledgedByUserId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
