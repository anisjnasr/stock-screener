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
      .from("position_lists")
      .select("*, position_items(*)")
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Position list not found" },
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
    const body = (await req.json()) as { name?: string };
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("position_lists")
      .update({ name: body.name?.trim() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to update position list" },
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
    await supabase.from("position_items").delete().eq("position_list_id", id);
    const { error } = await supabase.from("position_lists").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete position list" },
      { status: 502 }
    );
  }
}
