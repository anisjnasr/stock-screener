import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = requireApiKey(req);
  if (err) return err;
  const { id } = await params;
  try {
    const body = (await req.json()) as { symbol: string };
    const symbol = (body.symbol ?? "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from("watchlist_items")
      .select("id")
      .eq("watchlist_id", id)
      .eq("symbol", symbol)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(existing);
    }
    const { data, error } = await supabase
      .from("watchlist_items")
      .insert({ watchlist_id: id, symbol })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to add symbol" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = requireApiKey(req);
  if (err) return err;
  const { id } = await params;
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("watchlist_items")
      .delete()
      .eq("watchlist_id", id)
      .eq("symbol", symbol.toUpperCase());
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to remove symbol" },
      { status: 502 }
    );
  }
}
