-- CreateTable
CREATE TABLE `Provider` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `websiteUrl` VARCHAR(191) NULL,
    `supportUrl` VARCHAR(191) NULL,
    `supportEmail` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Category_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Industry` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Industry_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntegrationTag` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `IntegrationTag_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `App` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `acceptingNew` BOOLEAN NOT NULL DEFAULT true,
    `suspendedReason` TEXT NULL,
    `internalTest` BOOLEAN NOT NULL DEFAULT false,
    `providerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `tagline` VARCHAR(400) NOT NULL,
    `tags` VARCHAR(500) NOT NULL DEFAULT '',
    `searchText` TEXT NOT NULL DEFAULT '',
    `iconUrl` VARCHAR(1000) NULL,
    `screenshots` JSON NULL,
    `overview` JSON NULL,
    `launchUrl` VARCHAR(1000) NULL,
    `integrationType` VARCHAR(191) NOT NULL DEFAULT 'external',
    `launchClientId` VARCHAR(191) NULL,
    `supportChannels` JSON NULL,
    `privacyUrl` VARCHAR(1000) NULL,
    `termsUrl` VARCHAR(1000) NULL,
    `version` VARCHAR(191) NULL,
    `recommendWeight` INTEGER NOT NULL DEFAULT 0,
    `minMonthlyPrice` INTEGER NULL,
    `hasFreePlan` BOOLEAN NOT NULL DEFAULT false,
    `hasTrial` BOOLEAN NOT NULL DEFAULT false,
    `maxTrialDays` INTEGER NOT NULL DEFAULT 0,
    `draft` JSON NULL,
    `firstPublishedAt` DATETIME(3) NULL,
    `contentUpdatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `App_slug_key`(`slug`),
    UNIQUE INDEX `App_launchClientId_key`(`launchClientId`),
    INDEX `App_status_firstPublishedAt_idx`(`status`, `firstPublishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppRelease` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `publishedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AppRelease_appId_number_key`(`appId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanVersion` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `planKey` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `current` BOOLEAN NOT NULL DEFAULT true,
    `name` VARCHAR(191) NOT NULL,
    `priceType` VARCHAR(191) NOT NULL,
    `priceJpy` INTEGER NOT NULL DEFAULT 0,
    `trialDays` INTEGER NOT NULL DEFAULT 0,
    `includes` TEXT NOT NULL DEFAULT '',
    `limits` TEXT NOT NULL DEFAULT '',
    `externalContractRequired` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlanVersion_appId_current_idx`(`appId`, `current`),
    UNIQUE INDEX `PlanVersion_appId_planKey_version_key`(`appId`, `planKey`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `tenantName` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `planVersionId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `liveKey` VARCHAR(191) NULL,
    `priceJpySnapshot` INTEGER NOT NULL,
    `planNameSnapshot` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `cancelAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `suspendedReason` TEXT NULL,
    `statusBeforeSuspend` VARCHAR(191) NULL,
    `internalTest` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_liveKey_key`(`liveKey`),
    INDEX `Subscription_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `Subscription_appId_status_idx`(`appId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApplicationRequest` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `requestedByName` VARCHAR(191) NOT NULL DEFAULT '',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `termsVersion` VARCHAR(191) NOT NULL,
    `agreedAt` DATETIME(3) NOT NULL,
    `contactNote` TEXT NULL,
    `operatorNote` TEXT NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ApplicationRequest_subscriptionId_key`(`subscriptionId`),
    UNIQUE INDEX `ApplicationRequest_idempotencyKey_key`(`idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrialUsage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TrialUsage_tenantId_appId_key`(`tenantId`, `appId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `billingRecordId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SubscriptionPeriod_billingRecordId_key`(`billingRecordId`),
    INDEX `SubscriptionPeriod_subscriptionId_idx`(`subscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingRecord` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `amountJpy` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `receiptRef` VARCHAR(191) NULL,
    `paidAmountJpy` INTEGER NULL,
    `paidAt` DATETIME(3) NULL,
    `confirmedBy` VARCHAR(191) NULL,
    `refundedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BillingRecord_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `BillingRecord_subscriptionId_periodStart_key`(`subscriptionId`, `periodStart`),
    UNIQUE INDEX `BillingRecord_receiptRef_key`(`receiptRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Inquiry` (
    `id` VARCHAR(191) NOT NULL,
    `publicNo` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `company` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `assignee` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Inquiry_publicNo_key`(`publicNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentEntry` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `body` TEXT NOT NULL,
    `appId` VARCHAR(191) NULL,
    `version` VARCHAR(191) NOT NULL DEFAULT '1',
    `published` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ContentEntry_kind_slug_key`(`kind`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OperatorGrant` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'operator',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OperatorGrant_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `actorType` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `objectType` VARCHAR(191) NOT NULL,
    `objectId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromState` VARCHAR(191) NULL,
    `toState` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_objectType_objectId_idx`(`objectType`, `objectId`),
    INDEX `AuditEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `tenantName` VARCHAR(191) NULL,
    `isOwner` BOOLEAN NOT NULL DEFAULT false,
    `authMode` VARCHAR(191) NOT NULL,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `idToken` TEXT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `csrfToken` VARCHAR(191) NOT NULL,
    `lastVerifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthState` (
    `id` VARCHAR(191) NOT NULL,
    `verifier` VARCHAR(191) NOT NULL,
    `nonce` VARCHAR(191) NOT NULL,
    `returnTo` VARCHAR(191) NOT NULL DEFAULT '/',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LaunchTicket` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LaunchTicket_codeHash_key`(`codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RankingEntry` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `rank` INTEGER NOT NULL,
    `count` INTEGER NOT NULL,
    `computedAt` DATETIME(3) NOT NULL,

    INDEX `RankingEntry_computedAt_idx`(`computedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobLock` (
    `name` VARCHAR(191) NOT NULL,
    `lockedAt` DATETIME(3) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastResult` TEXT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_AppToCategory` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_AppToCategory_AB_unique`(`A`, `B`),
    INDEX `_AppToCategory_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_AppToIndustry` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_AppToIndustry_AB_unique`(`A`, `B`),
    INDEX `_AppToIndustry_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_AppToIntegrationTag` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_AppToIntegrationTag_AB_unique`(`A`, `B`),
    INDEX `_AppToIntegrationTag_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `App` ADD CONSTRAINT `App_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `Provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppRelease` ADD CONSTRAINT `AppRelease_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanVersion` ADD CONSTRAINT `PlanVersion_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planVersionId_fkey` FOREIGN KEY (`planVersionId`) REFERENCES `PlanVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApplicationRequest` ADD CONSTRAINT `ApplicationRequest_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionPeriod` ADD CONSTRAINT `SubscriptionPeriod_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingRecord` ADD CONSTRAINT `BillingRecord_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Inquiry` ADD CONSTRAINT `Inquiry_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentEntry` ADD CONSTRAINT `ContentEntry_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RankingEntry` ADD CONSTRAINT `RankingEntry_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AppToCategory` ADD CONSTRAINT `_AppToCategory_A_fkey` FOREIGN KEY (`A`) REFERENCES `App`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AppToCategory` ADD CONSTRAINT `_AppToCategory_B_fkey` FOREIGN KEY (`B`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AppToIndustry` ADD CONSTRAINT `_AppToIndustry_A_fkey` FOREIGN KEY (`A`) REFERENCES `App`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AppToIndustry` ADD CONSTRAINT `_AppToIndustry_B_fkey` FOREIGN KEY (`B`) REFERENCES `Industry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AppToIntegrationTag` ADD CONSTRAINT `_AppToIntegrationTag_A_fkey` FOREIGN KEY (`A`) REFERENCES `App`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AppToIntegrationTag` ADD CONSTRAINT `_AppToIntegrationTag_B_fkey` FOREIGN KEY (`B`) REFERENCES `IntegrationTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
