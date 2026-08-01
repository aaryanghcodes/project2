import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { db } from "./db";
import { fakeVerify, verifyPassword } from "./passwords";
import { signInSchema } from "./validation";

/**
 * Auth.js is configured with JWT sessions rather than database sessions: the
 * credentials provider does not support the database strategy. The token holds
 * only the user id — onboarding state is deliberately read fresh from the
 * database on each request, because a value baked into a two-week token would
 * go stale the moment someone finishes onboarding.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await db.user.findUnique({ where: { email } });

        // Spend the same time on a missing account as on a wrong password, so
        // response timing does not reveal which emails are registered.
        if (!user?.passwordHash) {
          await fakeVerify(password);
          return null;
        }

        if (!(await verifyPassword(password, user.passwordHash))) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

/** The signed-in user's id, or null. Use in server components and handlers. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Load the signed-in user with the fields the app routinely needs. Returns null
 * when signed out, or when the token references a user that no longer exists —
 * which happens after a database reset in development.
 */
export async function currentUser() {
  const id = await currentUserId();
  if (!id) return null;
  return db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      onboardingState: true,
    },
  });
}
