-- Persist PBX/WebPhone call lifecycle and CDR records.
ALTER TABLE `MessageGatewayConfig`
  ADD COLUMN `webphoneSipDomain` VARCHAR(253) NULL,
  ADD COLUMN `webphoneExtension` VARCHAR(64) NULL,
  ADD COLUMN `webphonePassword` TEXT NULL;

CREATE TABLE `CallLog` (
  `id` VARCHAR(191) NOT NULL,
  `providerCallId` VARCHAR(120) NULL,
  `orderId` VARCHAR(191) NULL,
  `userId` VARCHAR(191) NULL,
  `phone` VARCHAR(30) NOT NULL,
  `direction` VARCHAR(16) NOT NULL,
  `source` VARCHAR(24) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `disposition` VARCHAR(120) NULL,
  `agentName` VARCHAR(120) NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `answeredAt` DATETIME(3) NULL,
  `endedAt` DATETIME(3) NULL,
  `durationSeconds` INTEGER NOT NULL DEFAULT 0,
  `talkSeconds` INTEGER NOT NULL DEFAULT 0,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CallLog_providerCallId_key` (`providerCallId`),
  INDEX `CallLog_orderId_startedAt_idx` (`orderId`, `startedAt`),
  INDEX `CallLog_phone_startedAt_idx` (`phone`, `startedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CallLog_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `CallLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
