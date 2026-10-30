import type { JwtPayload } from "@supabase/supabase-js";

export function hasMfaAssurance(claims: JwtPayload | null | undefined): boolean {
  return claims?.aal === "aal2";
}
