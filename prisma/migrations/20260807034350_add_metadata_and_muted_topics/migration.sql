-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "entities" TEXT[],
ADD COLUMN     "keywords" TEXT[];

-- CreateTable
CREATE TABLE "muted_topics" (
    "user_id" TEXT NOT NULL,
    "interest_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muted_topics_pkey" PRIMARY KEY ("user_id","interest_id")
);

-- AddForeignKey
ALTER TABLE "muted_topics" ADD CONSTRAINT "muted_topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muted_topics" ADD CONSTRAINT "muted_topics_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
