-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "providerPaymentId" DROP NOT NULL,
ALTER COLUMN "providerChargeId" DROP NOT NULL,
ALTER COLUMN "providerRefundId" DROP NOT NULL;
