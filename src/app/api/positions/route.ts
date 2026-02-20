import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("position_lists")
      .select("*, position_items(*)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch position lists" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  try {
    const body = (await req.json()) as { name: string };
    const name = body.name?.trim() || "Positions";
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("position_lists")
      .insert({ name })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to create position list" },
      { status: 502 }
    );
  }
}
