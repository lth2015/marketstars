-- StarPay：請求ごとに加盟店番号を保持（手写，MySQL 8 兼容）
ALTER TABLE `BillingRecord` ADD COLUMN `starpayMerchantId` VARCHAR(191) NULL;
