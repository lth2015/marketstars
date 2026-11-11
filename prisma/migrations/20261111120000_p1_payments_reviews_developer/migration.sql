-- AlterTable
ALTER TABLE `App` ADD COLUMN `ratingAvg` DOUBLE NULL,
    ADD COLUMN `ratingCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reviewNote` TEXT NULL,
    ADD COLUMN `reviewStatus` VARCHAR(191) NOT NULL DEFAULT 'none',
    ADD COLUMN `submittedAt` DATETIME(3) NULL,
    MODIFY `screenshots` JSON NULL,
    MODIFY `overview` JSON NULL,
    MODIFY `supportChannels` JSON NULL,
    MODIFY `draft` JSON NULL;

-- AlterTable
ALTER TABLE `AppRelease` MODIFY `snapshot` JSON NOT NULL;

-- AlterTable
ALTER TABLE `AuditEvent` MODIFY `data` JSON NULL;

-- AlterTable
ALTER TABLE `Provider` ADD COLUMN `contactEmail` VARCHAR(191) NULL,
    ADD COLUMN `developerTermsVersion` VARCHAR(191) NULL,
    ADD COLUMN `ownerTenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Subscription` ADD COLUMN `autoRenew` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lastChargeError` TEXT NULL,
    ADD COLUMN `paymentMethodId` VARCHAR(191) NULL,
    ADD COLUMN `paymentMode` VARCHAR(191) NOT NULL DEFAULT 'invoice',
    ADD COLUMN `scheduledPlanVersionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `PaymentMethod` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerRef` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NOT NULL,
    `last4` VARCHAR(191) NOT NULL,
    `expMonth` INTEGER NOT NULL,
    `expYear` INTEGER NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentMethod_providerRef_key`(`providerRef`),
    INDEX `PaymentMethod_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentIntent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `planVersionId` VARCHAR(191) NOT NULL,
    `amountJpy` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'requires_payment',
    `paymentMethodId` VARCHAR(191) NULL,
    `providerChargeId` VARCHAR(191) NULL,
    `failureReason` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentIntent_providerChargeId_key`(`providerChargeId`),
    UNIQUE INDEX `PaymentIntent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `PaymentIntent_subscriptionId_idx`(`subscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Review` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `tenantName` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'published',
    `hiddenReason` VARCHAR(191) NULL,
    `replyBody` TEXT NULL,
    `repliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Review_appId_status_idx`(`appId`, `status`),
    UNIQUE INDEX `Review_appId_userId_key`(`appId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `App_reviewStatus_idx` ON `App`(`reviewStatus`);

-- CreateIndex
CREATE UNIQUE INDEX `Provider_ownerTenantId_key` ON `Provider`(`ownerTenantId`);

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_paymentMethodId_fkey` FOREIGN KEY (`paymentMethodId`) REFERENCES `PaymentMethod`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_scheduledPlanVersionId_fkey` FOREIGN KEY (`scheduledPlanVersionId`) REFERENCES `PlanVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentIntent` ADD CONSTRAINT `PaymentIntent_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentIntent` ADD CONSTRAINT `PaymentIntent_planVersionId_fkey` FOREIGN KEY (`planVersionId`) REFERENCES `PlanVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentIntent` ADD CONSTRAINT `PaymentIntent_paymentMethodId_fkey` FOREIGN KEY (`paymentMethodId`) REFERENCES `PaymentMethod`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

