import { NextResponse, type NextRequest } from "next/server";
import { OPS_COOKIE, SESSION_COOKIE } from "@/lib/auth/cookie";

// Optimistic check only: no cookie → sign-in page. Every /s page and action still verifies the
// session itself through requireSeller() (lib/auth/seller.ts), and every /ops one through
// requireOperator() (lib/auth/operator.ts).

const PUBLIC = new Set(["/s/login", "/s/signup", "/ops/login"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ops = pathname === "/ops" || pathname.startsWith("/ops/");
  // Pages also call notFound() when the console is off, but a streamed page has already sent 200.
  if (ops && !process.env.OPS_PASSWORD?.trim()) return new NextResponse("Not found", { status: 404 });
  // Routes answer 401 themselves; a redirect would hand fetch() the login page.
  if (pathname.startsWith("/ops/api/")) return NextResponse.next();
  if (PUBLIC.has(pathname) || request.cookies.has(ops ? OPS_COOKIE : SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL(ops ? "/ops/login" : "/s/login", request.url));
}

export const config = {
  matcher: ["/s", "/s/:path*", "/ops", "/ops/:path*"],
};
