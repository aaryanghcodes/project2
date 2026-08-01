import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Next dev reloads modules on every edit, which would open a new connection
// pool each time and exhaust Postgres. Cache the client on globalThis so a
// single pool survives hot reloads. In production the module is only
// evaluated once, so the cache is skipped.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
