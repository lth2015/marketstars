-- 账号注销申请（手写，MySQL 8 兼容）
CREATE TABLE `DeletionRequest` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `tenantName` VARCHAR(191) NULL,
    `openKey` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'submitted',
    `checks` JSON NOT NULL,
    `reason` TEXT NULL,
    `operatorNote` TEXT NULL,
    `ssoTicketRef` VARCHAR(191) NULL,
    `handledBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `DeletionRequest_openKey_key`(`openKey`),
    INDEX `DeletionRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `DeletionRequest_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
