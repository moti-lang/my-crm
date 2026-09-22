-- CreateTable
CREATE TABLE "DeferredNotification" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "leadId" TEXT,
    "taskId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "blockedOn" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "DeferredNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeferredNotification_deliveredAt_idx" ON "DeferredNotification"("deliveredAt");
