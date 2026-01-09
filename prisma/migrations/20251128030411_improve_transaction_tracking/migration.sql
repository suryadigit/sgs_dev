-- AlterTable
ALTER TABLE "AffiliateCommission" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "affiliateId" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "userId" TEXT;
