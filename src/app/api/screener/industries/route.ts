import { NextResponse } from "next/server";
import { getAllIndustryNames } from "@/lib/screener-db-native";

/** Distinct Yahoo Finance industry names from `companies` (same source as screener filters). */
export async function GET() {
  try {
    const industries = getAllIndustryNames();
    return NextResponse.json({ industries });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load industries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
