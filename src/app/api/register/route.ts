import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { signUpSchema } from "@/lib/validation";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid details." },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;

  try {
    const user = await db.user.create({
      data: {
        email,
        name: name || null,
        passwordHash: await hashPassword(password),
      },
      select: { id: true, email: true },
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    // P2002 is a unique constraint violation, i.e. the email is taken. Relying
    // on the constraint rather than a pre-check avoids the race where two
    // simultaneous signups both see the address as free.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }
    console.error("[register] unexpected failure", error);
    return NextResponse.json(
      { error: "Could not create the account. Please try again." },
      { status: 500 },
    );
  }
}
