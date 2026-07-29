-- CreateTable
CREATE TABLE "llm_provider_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKeyCipher" TEXT NOT NULL,
    "baseUrl" TEXT,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_provider_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_provider_settings_userId_key" ON "llm_provider_settings"("userId");

-- AddForeignKey
ALTER TABLE "llm_provider_settings" ADD CONSTRAINT "llm_provider_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
