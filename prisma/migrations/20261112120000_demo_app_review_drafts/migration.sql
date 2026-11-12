-- デモ接入アプリの作成履歴（手写，MySQL 8 兼容）
CREATE TABLE `DemoAppReviewDraft` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `review` TEXT NOT NULL,
    `rating` INTEGER NOT NULL,
    `tone` VARCHAR(191) NOT NULL,
    `store` VARCHAR(191) NOT NULL,
    `aiText` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `DemoAppReviewDraft_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
