-- StarPay 合算請求（手写，MySQL 8 兼容）
ALTER TABLE `BillingRecord` ADD COLUMN `channel` VARCHAR(191) NOT NULL DEFAULT 'direct',
    ADD COLUMN `starpayStatementId` VARCHAR(191) NULL;
CREATE INDEX `BillingRecord_channel_status_idx` ON `BillingRecord`(`channel`, `status`);
CREATE INDEX `BillingRecord_starpayStatementId_idx` ON `BillingRecord`(`starpayStatementId`);

CREATE TABLE `StarpayLink` (
    `tenantId` VARCHAR(191) NOT NULL,
    `merchantId` VARCHAR(191) NOT NULL,
    `merchantName` VARCHAR(191) NOT NULL,
    `linkedBy` VARCHAR(191) NOT NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `StarpayLink_merchantId_key`(`merchantId`),
    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StarpayStatement` (
    `id` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `totalJpy` INTEGER NOT NULL,
    `itemCount` INTEGER NOT NULL,
    `settledRef` VARCHAR(191) NULL,
    `settledAt` DATETIME(3) NULL,
    `settledBy` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `StarpayStatement_month_key`(`month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
