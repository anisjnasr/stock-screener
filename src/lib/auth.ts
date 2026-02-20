import { NextRequest, NextResponse } from "next/server";

const APP_API_KEY = process.env.APP_API_KEY;

export function getApiKeyFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const xKey = req.headers.get("x-api-key");
  if (xKey) return xKey.trim();
  return null;
}

export function requireApiKey(
  req: NextRequest
): NextResponse | null {
  if (!APP_API_KEY) {
    return NextResponse.json(
      { error: "Server missing APP_API_KEY" },
      { status: 500 }
    );
  }
  const key = getApiKeyFromRequest(req);
  if (!key || key !== APP_API_KEY) {
    return NextResponse.json(
      { error: "Invalid or missing access key" },
      { status: 401 }
    );
  }
  return null;
}
