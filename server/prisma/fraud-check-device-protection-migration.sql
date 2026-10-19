-- Additive migration for persistent BD Courier results and IP / phone / device protection.
-- Run once against the production database before restarting the updated application.

ALTER TABLE `Order`
  ADD COLUMN `deviceFingerprint` VARCHAR(64) NULL,
  ADD INDEX `Order_deviceFingerprint_createdAt_idx` (`deviceFingerprint`, `createdAt`);

ALTER TABLE `OrderRiskEvent`
  ADD COLUMN `deviceFingerprint` VARCHAR(64) NULL;

ALTER TABLE `OrderProtectionSettings`
  ADD COLUMN `checkIpBlockList` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `checkPhoneBlockList` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `checkDeviceBlockList` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `autoCheckBdCourier` BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE `PhoneBlock` (
  `id` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  `expiresAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PhoneBlock_phone_key` (`phone`),
  INDEX `PhoneBlock_revokedAt_expiresAt_idx` (`revokedAt`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DeviceBlock` (
  `id` VARCHAR(191) NOT NULL,
  `fingerprint` VARCHAR(64) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  `expiresAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `DeviceBlock_fingerprint_key` (`fingerprint`),
  INDEX `DeviceBlock_revokedAt_expiresAt_idx` (`revokedAt`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BdCourierFraudCheck` (
  `phone` VARCHAR(20) NOT NULL,
  `result` JSON NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`phone`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
