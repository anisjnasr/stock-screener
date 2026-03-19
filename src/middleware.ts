import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const start = Date.now();
  const response = NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Server-Timing", `total;dur=${Date.now() - start}`);
    response.headers.set("X-Route", request.nextUrl.pathname);
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
