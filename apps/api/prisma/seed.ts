/**
 * Seeds the four system roles with their default permission sets.
 * Idempotent — safe to run repeatedly.
 */
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient, RoleName } from '@prisma/client';

loadDotenv({ path: resolve(import.meta.dirname, '../.env') });
loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

import { ROLE_PERMISSIONS } from '@company-brain/types';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const name of Object.values(RoleName)) {
    const permissions = ROLE_PERMISSIONS[name];
    await prisma.role.upsert({
      where: { name },
      create: { name, permissions, description: `System role: ${name}` },
      update: { permissions },
    });
  }
  console.warn('Seeded system roles:', Object.values(RoleName).join(', '));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
