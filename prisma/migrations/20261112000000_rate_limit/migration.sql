-- 限流计数（手写，MySQL 8 兼容）
CREATE TABLE `RateLimit` (
    `key` VARCHAR(191) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    INDEX `RateLimit_windowStart_idx`(`windowStart`),
    PRIMARY KEY (`key`, `windowStart`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
