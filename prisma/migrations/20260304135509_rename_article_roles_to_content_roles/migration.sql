/*
  Warnings:

  - The values [ARTICLE_ADMIN,ARTICLE_APPROVER] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('GUEST', 'REGISTERED_USER', 'VERIFIED_USER', 'CONTENT_ADMIN', 'CONTENT_APPROVER', 'KB_UPLOADER', 'KB_APPROVER', 'CHAT_REVIEWER', 'SUPER_ADMIN');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'GUEST';
COMMIT;
