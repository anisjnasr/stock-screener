import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = requireApiKey(req);
  if (err) return err;
  const { id } = await params;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("saved_prompts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Prompt not found" },
      { status: 404 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = requireApiKey(req);
  if (err) return err;
  const { id } = await params;
  try {
    const body = (await req.json()) as { title?: string; prompt_text?: string };
    const supabase = getSupabase();
    const updates: { title?: string; prompt_text?: string } = {};
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.prompt_text !== undefined) updates.prompt_text = body.prompt_text.trim();
    const { data, error } = await supabase
      .from("saved_prompts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to update prompt" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = requireApiKey(_req);
  if (err) return err;
  const { id } = await params;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("saved_prompts").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete prompt" },
      { status: 502 }
    );
  }
}
