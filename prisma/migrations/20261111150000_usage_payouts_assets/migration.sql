-- 手写迁移（MySQL 8 / MariaDB 兼容）：按量计费、供应商结算、图片资产

-- BillingRecord：增加 kind，唯一约束改为 (subscriptionId, kind, periodStart)
ALTER TABLE `BillingRecord` DROP FOREIGN KEY `BillingRecord_subscriptionId_fkey`;
DROP INDEX `BillingRecord_subscriptionId_periodStart_key` ON `BillingRecord`;
ALTER TABLE `BillingRecord` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'subscription';
CREATE UNIQUE INDEX `BillingRecord_subscriptionId_kind_periodStart_key` ON `BillingRecord`(`subscriptionId`, `kind`, `periodStart`);
ALTER TABLE `BillingRecord` ADD CONSTRAINT `BillingRecord_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PlanVersion` ADD COLUMN `tokenPriceJpyPerMTok` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Provider` ADD COLUMN `payoutAccount` TEXT NULL,
    ADD COLUMN `revenueShareBps` INTEGER NOT NULL DEFAULT 7000;
ALTER TABLE `Subscription` ADD COLUMN `usageCapJpy` INTEGER NULL;

-- CreateTable
CREATE TABLE `UsageEvent` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `planVersionId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `inputTokens` INTEGER NOT NULL,
    `outputTokens` INTEGER NOT NULL,
    `unitPriceJpyPerMTok` INTEGER NOT NULL,
    `costMilliJpy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UsageEvent_subscriptionId_createdAt_idx`(`subscriptionId`, `createdAt`),
    INDEX `UsageEvent_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `UsageEvent_appId_requestId_key`(`appId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayoutStatement` (
    `id` VARCHAR(191) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `grossJpy` INTEGER NOT NULL,
    `refundJpy` INTEGER NOT NULL,
    `platformFeeJpy` INTEGER NOT NULL,
    `payoutJpy` INTEGER NOT NULL,
    `shareBps` INTEGER NOT NULL,
    `lines` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'confirmed',
    `paidAt` DATETIME(3) NULL,
    `paidReference` VARCHAR(191) NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PayoutStatement_providerId_month_key`(`providerId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Asset` (
    `id` VARCHAR(191) NOT NULL,
    `ownerType` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UsageEvent` ADD CONSTRAINT `UsageEvent_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayoutStatement` ADD CONSTRAINT `PayoutStatement_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `Provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
