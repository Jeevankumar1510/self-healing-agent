import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sha-dashboard-session";
export const SESSION_DURATION_SECONDS = 12 * 60 * 60;
export const MINIMUM_PASSWORD_LENGTH = 16;

export function createSessionToken(password: string, expiresAt: number): string {
  const expiry = String(expiresAt);
  const signature = createHmac("sha256", password).update(expiry).digest("hex");
  return `${expiry}.${signature}`;
}

export function passwordsMatch(submitted: string, expected: string): boolean {
  const submittedBuffer = Buffer.from(submitted);
  const expectedBuffer = Buffer.from(expected);
  return submittedBuffer.length === expectedBuffer.length && timingSafeEqual(submittedBuffer, expectedBuffer);
}

export function isValidSessionToken(
  token: string | undefined,
  password: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const expiry = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const expected = createHmac("sha256", password).update(expiry).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
