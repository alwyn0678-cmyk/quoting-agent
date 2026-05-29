import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/session";

// Next 16 renamed the "middleware" convention to "proxy" (same Edge request hook).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on all routes except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
