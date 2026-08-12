import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RoomCodeSchema = z.object({ code: z.string().min(1).max(8) });

export const findQuickMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;

    // Find the oldest queued player waiting for quick match.
    const { data: others, error: findErr } = await supabaseAdmin
      .from("match_queue")
      .select("user_id, display_name, avatar, elo")
      .is("room_code", null)
      .neq("user_id", me)
      .order("created_at", { ascending: true })
      .limit(1);

    if (findErr) throw new Error(findErr.message);
    if (!others || !others[0]) {
      // No opponent yet — enqueue self so the next caller matches us.
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("display_name, avatar, elo")
        .eq("id", me)
        .maybeSingle();
      await supabaseAdmin.from("match_queue").upsert({
        user_id: me,
        display_name: prof?.display_name ?? "Oyuncu",
        avatar: prof?.avatar ?? "♟",
        elo: prof?.elo ?? 1000,
        room_code: null,
      }, { onConflict: "user_id" });
      return { gameId: null as string | null };
    }

    const opp = others[0];

    const { data: myProf, error: myErr } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", me)
      .maybeSingle();
    if (myErr) throw new Error(myErr.message);
    const myName = myProf?.display_name ?? "Oyuncu";

    const { data: game, error: gameErr } = await supabaseAdmin
      .from("games")
      .insert({
        white_id: opp.user_id,
        black_id: me,
        white_name: opp.display_name ?? "Oyuncu",
        black_name: myName,
      })
      .select("id")
      .single();
    if (gameErr) throw new Error(gameErr.message);

    await supabaseAdmin.from("match_queue").delete().in("user_id", [opp.user_id, me]);

    return { gameId: game.id as string };
  });

export const createRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("display_name, avatar, elo")
      .eq("id", context.userId)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);

    const { error } = await supabaseAdmin.from("match_queue").upsert({
      user_id: context.userId,
      display_name: prof?.display_name ?? "Oyuncu",
      avatar: prof?.avatar ?? "♟",
      elo: prof?.elo ?? 1000,
      room_code: code,
    }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { code };
  });

export const joinRoomByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RoomCodeSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.toUpperCase();

    const { data: others, error: findErr } = await supabaseAdmin
      .from("match_queue")
      .select("user_id, display_name")
      .eq("room_code", code)
      .neq("user_id", context.userId)
      .limit(1);
    if (findErr) throw new Error(findErr.message);
    if (!others || !others[0]) throw new Error("Oda bulunamadi.");

    const opp = others[0];

    const { data: myProf, error: myErr } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (myErr) throw new Error(myErr.message);

    const { data: game, error: gameErr } = await supabaseAdmin
      .from("games")
      .insert({
        white_id: opp.user_id,
        black_id: context.userId,
        white_name: opp.display_name ?? "Oyuncu",
        black_name: myProf?.display_name ?? "Oyuncu",
        room_code: code,
      })
      .select("id")
      .single();
    if (gameErr) throw new Error(gameErr.message);

    await supabaseAdmin.from("match_queue").delete().eq("user_id", opp.user_id);
    return { gameId: game.id as string };
  });

export const cancelQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("match_queue").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getLeaderboard = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, avatar, elo, best_elo, wins, losses, draws")
      .order("elo", { ascending: false })
      .order("wins", { ascending: false })
      .order("draws", { ascending: false })
      .order("losses", { ascending: true })
      .order("display_name", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      display_name: string;
      avatar: string;
      elo: number;
      best_elo: number;
      wins: number;
      losses: number;
      draws: number;
    }>;
  });
