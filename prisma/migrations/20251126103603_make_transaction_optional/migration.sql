-- DropForeignKey
ALTER TABLE "AffiliateCommission" DROP CONSTRAINT "AffiliateCommission_transactionId_fkey";

-- AlterTable
ALTER TABLE "AffiliateCommission" ALTER COLUMN "transactionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
