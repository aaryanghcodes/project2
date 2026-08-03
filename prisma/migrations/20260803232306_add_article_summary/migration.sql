-- DropIndex
DROP INDEX "articles_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "user_taste_centroids_vector_hnsw_idx";

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "summary" TEXT;
