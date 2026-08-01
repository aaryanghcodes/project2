-- pgvector must exist before any vector(384) column is created.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "OnboardingState" AS ENUM ('INTERESTS', 'CALIBRATION', 'COMPLETE');

-- CreateEnum
CREATE TYPE "InterestSource" AS ENUM ('ONBOARDING', 'INFERRED');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('LIKE', 'DISLIKE', 'CLICK', 'DWELL', 'SAVE', 'HIDE');

-- CreateEnum
CREATE TYPE "InteractionContext" AS ENUM ('ONBOARDING', 'FEED');

-- CreateEnum
CREATE TYPE "CentroidPolarity" AS ENUM ('POS', 'NEG');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT,
    "image_url" TEXT,
    "onboarding_state" "OnboardingState" NOT NULL DEFAULT 'INTERESTS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interests" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "interest_group" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "emoji" TEXT,
    "seed_embedding" vector(384),

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_interests" (
    "user_id" TEXT NOT NULL,
    "interest_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" "InterestSource" NOT NULL DEFAULT 'ONBOARDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("user_id","interest_id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "url_hash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "author" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content_snippet" TEXT,
    "image_url" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "story_cluster_id" TEXT,
    "embedding" vector(384),

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_topics" (
    "article_id" TEXT NOT NULL,
    "interest_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "article_topics_pkey" PRIMARY KEY ("article_id","interest_id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "dwell_ms" INTEGER,
    "context" "InteractionContext" NOT NULL DEFAULT 'FEED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_taste_centroids" (
    "user_id" TEXT NOT NULL,
    "polarity" "CentroidPolarity" NOT NULL,
    "idx" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "article_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vector" vector(384),

    CONSTRAINT "user_taste_centroids_pkey" PRIMARY KEY ("user_id","polarity","idx")
);

-- CreateTable
CREATE TABLE "impressions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "session_id" TEXT,
    "shown_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "interests_slug_key" ON "interests"("slug");

-- CreateIndex
CREATE INDEX "interests_interest_group_sort_order_idx" ON "interests"("interest_group", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "articles_url_hash_key" ON "articles"("url_hash");

-- CreateIndex
CREATE INDEX "articles_published_at_idx" ON "articles"("published_at" DESC);

-- CreateIndex
CREATE INDEX "articles_story_cluster_id_idx" ON "articles"("story_cluster_id");

-- CreateIndex
CREATE INDEX "article_topics_interest_id_idx" ON "article_topics"("interest_id");

-- CreateIndex
CREATE INDEX "interactions_user_id_created_at_idx" ON "interactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "interactions_user_id_article_id_type_key" ON "interactions"("user_id", "article_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "impressions_user_id_article_id_key" ON "impressions"("user_id", "article_id");

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_taste_centroids" ADD CONSTRAINT "user_taste_centroids_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approximate-nearest-neighbour indexes for cosine distance (<=>).
-- HNSW gives fast recall at our scale and is what the feed's candidate
-- retrieval relies on; without it every feed request degrades to a seq scan.
CREATE INDEX "articles_embedding_hnsw_idx"
    ON "articles" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "user_taste_centroids_vector_hnsw_idx"
    ON "user_taste_centroids" USING hnsw ("vector" vector_cosine_ops);
