import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Optimistic check only: no cookie → sign-in page. Every /s page and action still verifies the
// session itself through requireSeller() (lib/auth/seller.ts).

const PUBLIC = new Set(["/s/login", "/s/signup"]);

export function proxy(request: NextRequest) {
  if (PUBLIC.has(request.nextUrl.pathname) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL("/s/login", request.url));
}

export const config = {
  matcher: ["/s", "/s/:path*"],
};
