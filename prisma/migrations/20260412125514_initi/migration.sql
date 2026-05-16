/*
  Warnings:

  - Made the column `providerPaymentId` on table `payments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `providerChargeId` on table `payments` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "providerPaymentId" SET NOT NULL,
ALTER COLUMN "providerChargeId" SET NOT NULL;
