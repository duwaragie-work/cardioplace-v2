-- AlterTable: add roles array and migrate data from single role, then drop role
ALTER TABLE "User" ADD COLUMN "roles" "UserRole"[] NOT NULL DEFAULT ARRAY['GUEST']::"UserRole"[];

-- Preserve existing role data: copy single role into roles array
UPDATE "User" SET "roles" = ARRAY["role"]::"UserRole"[];

-- Drop the single role column
ALTER TABLE "User" DROP COLUMN "role";
