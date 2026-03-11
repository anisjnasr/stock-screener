import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasApiKey: Boolean(process.env.MASSIVE_API_KEY),
  });
}
