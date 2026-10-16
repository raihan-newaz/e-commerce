import prisma from '../prisma';

async function main() {
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS `AdminDropdownConfig` (`key` VARCHAR(180) NOT NULL, `options` JSON NOT NULL, `version` INTEGER NOT NULL DEFAULT 1, `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`key`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  console.log('Admin dropdown configuration table is ready.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
