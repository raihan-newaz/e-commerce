-- Additive migration for courier area matching, order protection and incomplete checkouts.
-- Apply once after backing up the database, then run `npx prisma generate`.

ALTER TABLE `Order`
  ADD COLUMN `sourceChannel` VARCHAR(32) NULL,
  ADD COLUMN `sourceIp` VARCHAR(45) NULL,
  ADD COLUMN `orderFingerprint` VARCHAR(64) NULL,
  ADD COLUMN `riskReasons` JSON NULL,
  ADD COLUMN `riskReviewStatus` VARCHAR(20) NOT NULL DEFAULT 'CLEAR',
  ADD INDEX `Order_sourceIp_createdAt_idx` (`sourceIp`, `createdAt`),
  ADD INDEX `Order_orderFingerprint_createdAt_idx` (`orderFingerprint`, `createdAt`);

CREATE TABLE `OrderCourierLocation` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `districtExternalId` VARCHAR(80) NULL,
  `thanaExternalId` VARCHAR(80) NULL,
  `areaExternalId` VARCHAR(80) NULL,
  `areaName` VARCHAR(100) NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'UNRESOLVED',
  `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `OrderCourierLocation_orderId_provider_key` (`orderId`, `provider`),
  PRIMARY KEY (`id`),
  CONSTRAINT `OrderCourierLocation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CourierLocationAlias` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `level` VARCHAR(20) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `alias` VARCHAR(100) NOT NULL,
  `normalizedAlias` VARCHAR(100) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `CourierLocationAlias_provider_level_locationId_normalizedAlias_key` (`provider`, `level`, `locationId`, `normalizedAlias`),
  INDEX `CourierLocationAlias_provider_level_normalizedAlias_idx` (`provider`, `level`, `normalizedAlias`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderProtectionSettings` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'default',
  `duplicateWindowMinutes` INTEGER NOT NULL DEFAULT 15,
  `phoneHourlyLimit` INTEGER NOT NULL DEFAULT 3,
  `phoneDailyLimit` INTEGER NOT NULL DEFAULT 6,
  `ipHourlyLimit` INTEGER NOT NULL DEFAULT 10,
  `autoBlockRejectCount` INTEGER NOT NULL DEFAULT 5,
  `autoBlockWindowMinutes` INTEGER NOT NULL DEFAULT 15,
  `autoBlockMinutes` INTEGER NOT NULL DEFAULT 60,
  `sharedIpPhoneThreshold` INTEGER NOT NULL DEFAULT 3,
  `sharedAddressPhoneThreshold` INTEGER NOT NULL DEFAULT 3,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `OrderProtectionSettings` (`id`, `updatedAt`) VALUES ('default', CURRENT_TIMESTAMP(3));

CREATE TABLE `IpBlock` (
  `id` VARCHAR(191) NOT NULL,
  `ipAddress` VARCHAR(45) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  `expiresAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `IpBlock_ipAddress_key` (`ipAddress`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderRiskEvent` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NULL,
  `source` VARCHAR(32) NOT NULL,
  `decision` VARCHAR(20) NOT NULL,
  `phone` VARCHAR(20) NULL,
  `ipAddress` VARCHAR(45) NULL,
  `reasons` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `OrderRiskEvent_ipAddress_decision_createdAt_idx` (`ipAddress`, `decision`, `createdAt`),
  INDEX `OrderRiskEvent_phone_createdAt_idx` (`phone`, `createdAt`),
  INDEX `OrderRiskEvent_orderId_createdAt_idx` (`orderId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderRateLock` (
  `key` VARCHAR(100) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IncompleteCheckout` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `pageSlug` VARCHAR(120) NULL,
  `customerName` VARCHAR(100) NOT NULL,
  `customerPhone` VARCHAR(20) NOT NULL,
  `address` VARCHAR(300) NOT NULL,
  `district` VARCHAR(80) NULL,
  `city` VARCHAR(80) NULL,
  `email` VARCHAR(160) NULL,
  `items` JSON NOT NULL,
  `deliveryArea` VARCHAR(30) NULL,
  `paymentMethod` VARCHAR(20) NOT NULL DEFAULT 'COD',
  `couponCode` VARCHAR(40) NULL,
  `ipAddress` VARCHAR(45) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `staffNote` TEXT NULL,
  `orderId` VARCHAR(191) NULL,
  `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `IncompleteCheckout_tokenHash_key` (`tokenHash`),
  UNIQUE INDEX `IncompleteCheckout_orderId_key` (`orderId`),
  INDEX `IncompleteCheckout_status_lastActivityAt_idx` (`status`, `lastActivityAt`),
  INDEX `IncompleteCheckout_customerPhone_lastActivityAt_idx` (`customerPhone`, `lastActivityAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `IncompleteCheckout_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
