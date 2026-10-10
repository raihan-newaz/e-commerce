-- AlterTable
ALTER TABLE `Order` ADD COLUMN `customerEmail` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `EmailSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `host` VARCHAR(253) NOT NULL DEFAULT '',
    `port` INTEGER NOT NULL DEFAULT 587,
    `secure` BOOLEAN NOT NULL DEFAULT false,
    `username` VARCHAR(254) NOT NULL DEFAULT '',
    `password` TEXT NULL,
    `fromName` VARCHAR(191) NOT NULL DEFAULT 'NIX Commerce',
    `fromEmail` VARCHAR(254) NOT NULL DEFAULT '',
    `replyTo` VARCHAR(254) NOT NULL DEFAULT '',
    `adminRecipients` TEXT NOT NULL DEFAULT '',
    `templates` LONGTEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `event` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `subject` TEXT NOT NULL,
    `html` LONGTEXT NOT NULL,
    `text` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `error` VARCHAR(191) NULL,
    `claimedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailDelivery_dedupeKey_key`(`dedupeKey`),
    INDEX `EmailDelivery_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `EmailDelivery_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckoutAttempt` (
    `key` VARCHAR(64) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `response` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CheckoutAttempt_orderId_key`(`orderId`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailDelivery` ADD CONSTRAINT `EmailDelivery_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckoutAttempt` ADD CONSTRAINT `CheckoutAttempt_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
