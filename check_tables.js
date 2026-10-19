const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const tables = await prisma.$queryRawUnsafe('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()');
    console.log('TABLES:', tables.map(t => Object.values(t)[0]));
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
