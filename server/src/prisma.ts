import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  // Prisma error dumps may include query input. Production logs are redacted
  // by the application's error handler instead of exporting customer data.
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : [],
});

export default prisma;
