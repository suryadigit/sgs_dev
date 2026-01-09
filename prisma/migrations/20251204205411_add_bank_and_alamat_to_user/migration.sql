-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPERADMIN');

-- AlterTable
ALTER TABLE "AffiliateProfile" ADD COLUMN     "totalOmset" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alamat" TEXT,
ADD COLUMN     "bank" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';
