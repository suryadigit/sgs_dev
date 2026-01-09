/*
  Warnings:

  - You are about to drop the column `registrationTransactionId` on the `AffiliateProfile` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AffiliateProfile" DROP CONSTRAINT "AffiliateProfile_registrationTransactionId_fkey";

-- AlterTable
ALTER TABLE "AffiliateProfile" DROP COLUMN "registrationTransactionId";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "amount" DOUBLE PRECISION,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "type" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
