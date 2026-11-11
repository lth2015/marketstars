-- AgentPay 与防篡改结算台帐（手写，MySQL 8 / MariaDB 兼容）
CREATE TABLE `AgentMandate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `tenantName` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `keyPrefix` VARCHAR(191) NOT NULL,
    `keyHash` VARCHAR(191) NOT NULL,
    `scopes` VARCHAR(191) NOT NULL,
    `allowedAppIds` JSON NULL,
    `monthlyBudgetJpy` INTEGER NOT NULL,
    `perTxLimitJpy` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AgentMandate_keyHash_key`(`keyHash`),
    INDEX `AgentMandate_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AgentTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `mandateId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NULL,
    `subscriptionId` VARCHAR(191) NULL,
    `amountJpy` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AgentTransaction_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `AgentTransaction_mandateId_idempotencyKey_key`(`mandateId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LedgerEntry` (
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `amountJpy` INTEGER NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `providerId` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `payload` JSON NOT NULL,
    `prevHash` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `LedgerEntry_hash_key`(`hash`),
    UNIQUE INDEX `LedgerEntry_kind_refId_key`(`kind`, `refId`),
    PRIMARY KEY (`seq`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LedgerAnchor` (
    `id` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `entries` INTEGER NOT NULL,
    `target` VARCHAR(191) NOT NULL DEFAULT 'none',
    `txRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AgentTransaction` ADD CONSTRAINT `AgentTransaction_mandateId_fkey` FOREIGN KEY (`mandateId`) REFERENCES `AgentMandate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
