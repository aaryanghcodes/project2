import type { DefaultSession } from "next-auth";

// Auth.js's default session user has no id. We put one there in the session
// callback, so widen the type to match.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export {};
