import bcrypt from "bcryptjs";

// 12 rounds is the current sensible default: comfortably slow for an attacker,
// still ~200ms on ordinary hardware.
const COST = 12;

// A valid hash of a random string, used to burn the same CPU time when an
// account does not exist. Without it, "no such user" returns measurably faster
// than "wrong password", which lets an attacker enumerate registered emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", COST);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Equal-cost rejection for a missing account. Always returns false. */
export async function fakeVerify(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}
