import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("saved_prompts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch prompts" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  try {
    const body = (await req.json()) as { title: string; prompt_text: string };
    const title = body.title?.trim() || "Custom";
    const prompt_text = body.prompt_text?.trim() || "";
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("saved_prompts")
      .insert({ title, prompt_text })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to create prompt" },
      { status: 502 }
    );
  }
}
