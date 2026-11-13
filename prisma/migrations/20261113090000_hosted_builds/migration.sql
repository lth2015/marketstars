-- MarketStars ホスティング（静的サイト）のビルドとファイル（手写，MySQL 8 兼容）
ALTER TABLE `App` ADD COLUMN `hostedBuildId` VARCHAR(191) NULL;

CREATE TABLE `HostedBuild` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `fileCount` INTEGER NOT NULL DEFAULT 0,
    `totalBytes` INTEGER NOT NULL DEFAULT 0,
    `log` JSON NOT NULL,
    `uploadedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    UNIQUE INDEX `HostedBuild_appId_number_key`(`appId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HostedFile` (
    `id` VARCHAR(191) NOT NULL,
    `buildId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(300) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    UNIQUE INDEX `HostedFile_buildId_path_key`(`buildId`, `path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `HostedFile` ADD CONSTRAINT `HostedFile_buildId_fkey` FOREIGN KEY (`buildId`) REFERENCES `HostedBuild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
