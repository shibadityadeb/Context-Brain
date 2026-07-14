-- Google OAuth is now the only sign-in method; accounts have no password.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
