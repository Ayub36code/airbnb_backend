/*
  Warnings:

  - Made the column `providerRefundId` on table `payments` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "providerRefundId" SET NOT NULL;
