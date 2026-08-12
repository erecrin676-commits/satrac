import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { findQuickMatch, createRoom, joinRoomByCode, cancelQueue } from "@/lib/matchmaking.functions";

export const Route = createFileRoute("/_authenticated/online")({
  validateSearch: (s: Record<string, unknown>) => ({
    game: typeof s.game === "string" ? s.game : undefined,
    room: typeof s.room === "string" ? s.room.toUpperCase().slice(0, 8) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Online Maç — Satranç Grandmaster" },
      { name: "description", content: "Oda kur, davet linkini paylaş, gerçek zamanlı 2 kişilik satranç oyna." },
      { property: "og:title", content: "Online Maç — Satranç Grandmaster" },
      { property: "og:description", content: "Oda kur, davet linkini paylaş, arkadaşınla satranç oyna." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OnlinePage,
});

type Me = { id: string; name: string; avatar: string; elo: number };

type GameRow = {
  id: string;
  white_id: string;
  black_id: string;
  white_name: string;
  black_name: string;
  fen: string;
  moves: string[];
  status: string;
  result: string | null;
  room_code: string | null;
};

function OnlinePage() {
  const { game: gameId, room: invitedRoom } = Route.useSearch();
  const nav = useNavigate();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, avatar, elo")
        .eq("id", u.user.id)
        .maybeSingle();
      setMe({
        id: u.user.id,
        name: prof?.display_name ?? "Oyuncu",
        avatar: prof?.avatar ?? "♟",
        elo: prof?.elo ?? 1000,
      });
    })();
  }, []);

  if (!me) return <div className="min-h-screen grid place-items-center bg-neutral-950 text-white">Yükleniyor…</div>;
  if (gameId) return <GameView gameId={gameId} me={me} onLeave={() => nav({ to: "/online" })} />;
  return <Lobby me={me} invitedRoom={invitedRoom} onEnter={(id) => nav({ to: "/online", search: { game: id } })} />;
}

function Lobby({ me, invitedRoom, onEnter }: { me: Me; invitedRoom?: string; onEnter: (id: string) => void }) {
  const [status, setStatus] = useState<string>("");
  const [roomInput, setRoomInput] = useState(invitedRoom ?? "");
  const [myRoomCode, setMyRoomCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "code" | "link">(null);
  const [busy, setBusy] = useState<null | "quick" | "create" | "join">(null);
  const cancelledRef = useRef(false);
  const doQuickMatch = useServerFn(findQuickMatch);
  const doCreateRoom = useServerFn(createRoom);
  const doJoinRoom = useServerFn(joinRoomByCode);
  const doCancel = useServerFn(cancelQueue);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  // Poll + realtime for a game where I'm a player.
  useEffect(() => {
    let done = false;
    setStatus((s) => s || "Realtime bağlantısı kuruluyor…");
    const check = async () => {
      const { data } = await supabase
        .from("games")
        .select("id")
        .or(`white_id.eq.${me.id},black_id.eq.${me.id}`)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data[0] && !cancelledRef.current && !done) {
        done = true;
        setStatus("🎯 Eşleşme bulundu! Oyuna geçiliyor…");
        onEnter(data[0].id as string);
      }
    };
    const int = setInterval(check, 1500);
    const ch = supabase
      .channel(`lobby_${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "games" },
        (p) => {
          const g: any = p.new;
          if ((g.white_id === me.id || g.black_id === me.id) && !done) {
            done = true;
            setStatus("🎯 Eşleşme bulundu! Oyuna geçiliyor…");
            onEnter(g.id as string);
          }
        },
      )
      .subscribe((st) => {
        if (st === "SUBSCRIBED") {
          setStatus((s) => (s === "Realtime bağlantısı kuruluyor…" ? "✅ Bağlandı — hazır" : s));
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
          setStatus("⚠️ Realtime bağlantı hatası — yeniden deneniyor…");
        }
      });
    return () => { clearInterval(int); supabase.removeChannel(ch); };
  }, [me.id, onEnter]);


  async function quickMatch() {
    setBusy("quick");
    setStatus("🔍 Rakip aranıyor…");
    try {
      const { gameId } = await doQuickMatch();
      if (gameId) {
        setStatus("🎯 Rakip bulundu! Oyuna geçiliyor…");
        onEnter(gameId);
      } else {
        setStatus("⏳ Kuyruktasınız — rakip bekleniyor…");
      }
    } catch (e) {
      setStatus("❌ Hata: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateRoom() {
    setBusy("create");
    setStatus("🏠 Oda oluşturuluyor…");
    try {
      const { code } = await doCreateRoom();
      setMyRoomCode(code);
      setStatus("🟢 Oda hazır — davet linkini paylaş, rakip bekleniyor…");
    } catch (e) {
      setStatus("❌ Hata: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleJoinRoom() {
    const code = roomInput.trim().toUpperCase();
    if (!code) {
      setStatus("⚠️ Oda kodu girin");
      return;
    }
    setBusy("join");
    setStatus(`🚪 ${code} odasına katılınıyor…`);
    try {
      const { gameId } = await doJoinRoom({ data: { code } });
      setStatus("🎯 Katıldın! Oyuna geçiliyor…");
      onEnter(gameId);
    } catch (e) {
      setStatus("❌ Hata: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  const inviteLink = myRoomCode && typeof window !== "undefined"
    ? `${window.location.origin}/online?room=${myRoomCode}`
    : "";

  async function copy(what: "code" | "link") {
    const text = what === "code" ? (myRoomCode ?? "") : inviteLink;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setStatus("⚠️ Kopyalanamadı — elle seçip kopyalayın");
    }
  }

  async function shareInvite() {
    if (!inviteLink) return;
    const nav2 = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav2.share) {
      try {
        await nav2.share({
          title: "Satranç daveti",
          text: `Benimle satranç oyna! Oda kodu: ${myRoomCode}`,
          url: inviteLink,
        });
        return;
      } catch { /* kullanıcı iptal etti */ }
    }
    void copy("link");
  }

  async function cancel() {
    try {
      await doCancel();
    } catch { /* ignore */ }
    setMyRoomCode(null);
    setStatus("");
  }

  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const waiting = status.includes("bekleniyor") || status.includes("Kuyruk") || status.includes("aran");

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6">
      <div className="max-w-md mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">♟ Online Oyun</h1>
          <Link to="/" className="text-sm text-neutral-400 hover:text-white">← Oyun</Link>
        </div>

        {invitedRoom && !myRoomCode && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <div className="font-semibold">📨 Davet aldın</div>
            <div className="text-neutral-300 mt-1">
              <b className="tracking-widest">{invitedRoom}</b> odasına katılmaya hazırsın. Sen <b>Siyah</b> oynayacaksın.
            </div>
            <button
              onClick={handleJoinRoom}
              disabled={busy !== null}
              className="mt-3 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-4 py-2.5 font-semibold"
            >
              {busy === "join" ? "Katılınıyor…" : "Davete katıl"}
            </button>
          </div>
        )}

        {myRoomCode ? (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-4">
            <ol className="flex items-center justify-between text-[11px] text-neutral-400">
              <li className="text-emerald-400 font-semibold">1 · Oda kuruldu</li>
              <li>→</li>
              <li className="text-white font-semibold">2 · Davet et</li>
              <li>→</li>
              <li>3 · Maç başlar</li>
            </ol>

            <div className="text-center">
              <div className="text-xs text-neutral-400">Oda kodu</div>
              <div className="text-4xl font-bold tracking-[0.35em] pl-[0.35em]">{myRoomCode}</div>
              <div className="text-xs text-neutral-400 mt-1">Rakip bekleniyor… (sen: Beyaz)</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => copy("code")} className="rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm font-semibold">
                {copied === "code" ? "✅ Kopyalandı" : "📋 Kodu kopyala"}
              </button>
              <button onClick={() => copy("link")} className="rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm font-semibold">
                {copied === "link" ? "✅ Kopyalandı" : "🔗 Linki kopyala"}
              </button>
            </div>

            <button onClick={shareInvite} className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2.5 font-semibold">
              📤 Davet gönder
            </button>

            <div className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[11px] text-neutral-400 break-all">
              {inviteLink}
            </div>

            <div className="pointer-events-none opacity-90">
              <Chessboard options={{ position: startFen, allowDragging: false }} />
            </div>

            <button onClick={cancel} className="w-full rounded-xl bg-red-600/80 hover:bg-red-600 px-4 py-2 text-sm font-semibold">
              Odayı iptal et
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
              <div className="text-sm font-semibold">⚡ Hızlı Eşleşme</div>
              <p className="text-xs text-neutral-400">Rastgele bir rakiple hemen eşleş.</p>
              <button
                onClick={quickMatch}
                disabled={busy !== null}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-3 font-semibold"
              >
                {busy === "quick" ? "Aranıyor…" : "Rakip bul"}
              </button>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
              <div className="text-sm font-semibold">🏠 Arkadaşını davet et</div>
              <p className="text-xs text-neutral-400">Oda kur, kodu veya davet linkini paylaş. Sen Beyaz oynarsın.</p>
              <button
                onClick={handleCreateRoom}
                disabled={busy !== null}
                className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-4 py-3 font-semibold"
              >
                {busy === "create" ? "Oluşturuluyor…" : "Oda oluştur"}
              </button>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
              <div className="text-sm font-semibold">🚪 Odaya katıl</div>
              <p className="text-xs text-neutral-400">Sana gelen 5 haneli oda kodunu gir.</p>
              <div className="flex gap-2">
                <input
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleJoinRoom(); }}
                  placeholder="ODA KODU"
                  aria-label="Oda kodu"
                  className="flex-1 rounded-xl bg-white/10 px-3 py-2 uppercase tracking-widest text-center outline-none focus:ring-2 focus:ring-emerald-500/60"
                  maxLength={8}
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={busy !== null || !roomInput.trim()}
                  className="rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 px-4 py-2 font-semibold"
                >
                  {busy === "join" ? "…" : "Katıl"}
                </button>
              </div>
            </div>
          </div>
        )}

        {status && (
          <div className="rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-center text-neutral-200">
            <div className="font-medium">{status}</div>
            {waiting && (
              <button onClick={cancel} className="mt-1 text-xs underline text-red-400 hover:text-red-300">
                iptal et
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


type Presence = { user_id: string; name: string; avatar: string; ready: boolean; at: number };

function GameView({ gameId, me, onLeave }: { gameId: string; me: Me; onLeave: () => void }) {
  const [row, setRow] = useState<GameRow | null>(null);
  const [msg, setMsg] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [gameChat, setGameChat] = useState<Array<{ id: string; user_id: string; display_name: string; content: string }>>([]);
  const [conn, setConn] = useState<"connecting" | "online" | "error">("connecting");
  const [peers, setPeers] = useState<Presence[]>([]);
  const [ready, setReady] = useState(false);
  const presenceRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    supabase.from("games").select("*").eq("id", gameId).maybeSingle().then(({ data }) => {
      if (data) setRow(data as unknown as GameRow);
    });
    const ch = supabase
      .channel(`game_${gameId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
        (p) => setRow(p.new as unknown as GameRow),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  // Live presence: who is in the room, ready state, connection status
  useEffect(() => {
    setConn("connecting");
    const ch = supabase.channel(`presence_game_${gameId}`, {
      config: { presence: { key: me.id } },
    });
    presenceRef.current = ch;
    const sync = () => {
      const state = ch.presenceState() as Record<string, Array<Partial<Presence>>>;
      const list: Presence[] = Object.values(state).flatMap((arr) =>
        arr.map((p) => ({
          user_id: String(p.user_id ?? ""),
          name: String(p.name ?? "Oyuncu"),
          avatar: String(p.avatar ?? "♟"),
          ready: Boolean(p.ready),
          at: Number(p.at ?? 0),
        })),
      );
      const uniq = new Map<string, Presence>();
      for (const p of list) uniq.set(p.user_id, p);
      setPeers([...uniq.values()]);
    };
    ch.on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (st) => {
        if (st === "SUBSCRIBED") {
          setConn("online");
          await ch.track({ user_id: me.id, name: me.name, avatar: me.avatar, ready: false, at: Date.now() });
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
          setConn("error");
        }
      });
    return () => { presenceRef.current = null; supabase.removeChannel(ch); };
  }, [gameId, me.id, me.name, me.avatar]);

  async function toggleReady() {
    const next = !ready;
    setReady(next);
    await presenceRef.current?.track({
      user_id: me.id, name: me.name, avatar: me.avatar, ready: next, at: Date.now(),
    });
  }


  // In-game chat (reuse chat_messages but tag with prefix)
  useEffect(() => {
    const tag = `[game:${gameId}]`;
    supabase
      .from("chat_messages")
      .select("*")
      .ilike("content", `${tag}%`)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        setGameChat((data ?? []).map((m: any) => ({
          id: m.id, user_id: m.user_id, display_name: m.display_name,
          content: (m.content as string).slice(tag.length).trimStart(),
        })));
      });
    const ch = supabase
      .channel(`gamechat_${gameId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
        const m: any = p.new;
        if (typeof m.content === "string" && m.content.startsWith(tag)) {
          setGameChat((cur) => [...cur, {
            id: m.id, user_id: m.user_id, display_name: m.display_name,
            content: m.content.slice(tag.length).trimStart(),
          }]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [gameChat.length]);

  const chess = useMemo(() => {
    const c = new Chess();
    if (row?.fen) try { c.load(row.fen); } catch { /* ignore */ }
    return c;
  }, [row?.fen]);

  if (!row) return <div className="min-h-screen grid place-items-center bg-neutral-950 text-white">Yükleniyor…</div>;

  const iAmWhite = row.white_id === me.id;
  const iAmBlack = row.black_id === me.id;
  const myColor: "w" | "b" | null = iAmWhite ? "w" : iAmBlack ? "b" : null;
  const myTurn = myColor && chess.turn() === myColor && row.status === "active";

  async function tryMove(from: string, to: string, promotion = "q"): Promise<boolean> {
    if (!row || !myTurn) return false;
    const test = new Chess(row.fen);
    let mv;
    try {
      mv = test.move({ from, to, promotion });
    } catch {
      return false;
    }
    if (!mv) return false;

    const newFen = test.fen();
    const newMoves = [...(row.moves ?? []), mv.san];
    let status = "active";
    let result: string | null = null;
    if (test.isCheckmate()) {
      status = "finished";
      result = test.turn() === "w" ? "black" : "white";
    } else if (test.isDraw() || test.isStalemate() || test.isThreefoldRepetition() || test.isInsufficientMaterial()) {
      status = "finished";
      result = "draw";
    }
    const { error } = await supabase
      .from("games")
      .update({ fen: newFen, moves: newMoves, status, result })
      .eq("id", gameId);
    if (error) return false;
    return true;
  }

  async function resign() {
    if (!myColor) return;
    if (!confirm("Teslim olmak istediğinize emin misiniz?")) return;
    await supabase.from("games").update({
      status: "finished",
      result: myColor === "w" ? "black" : "white",
    }).eq("id", gameId);
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!msg.trim()) return;
    const content = `[game:${gameId}] ${msg.trim().slice(0, 400)}`;
    setMsg("");
    await supabase.from("chat_messages").insert({
      user_id: me.id,
      display_name: me.name,
      avatar: me.avatar,
      content,
    });
  }

  const opponentName = iAmWhite ? row.black_name : row.white_name;
  const finished = row.status === "finished";
  const won = finished && row.result === (myColor === "w" ? "white" : "black");
  const lost = finished && row.result && row.result !== "draw" && !won;
  const drew = finished && row.result === "draw";

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col lg:flex-row">
      <div className="flex-1 p-4 flex flex-col items-center">
        <div className="w-full max-w-md flex items-center justify-between mb-3">
          <button onClick={onLeave} className="text-sm text-neutral-400 hover:text-white">← Lobi</button>
          <div className="text-sm">
            <b>{iAmWhite ? "Beyaz" : iAmBlack ? "Siyah" : "Seyirci"}</b> · rakip: {opponentName}
          </div>
        </div>

        {/* Canlı durum paneli */}
        <div className="w-full max-w-md mb-3 rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-200">📡 Canlı durum</span>
            <span className="flex items-center gap-1.5 text-neutral-300">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  conn === "online" ? "bg-emerald-400 animate-pulse" : conn === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-500"
                }`}
              />
              {conn === "online" ? "Bağlı" : conn === "connecting" ? "Bağlanıyor…" : "Bağlantı hatası"}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>👥 Odadaki oyuncu: <b className="text-white">{peers.length}</b> / 2</span>
            <span>{peers.filter((p) => p.ready).length}/{peers.length || 0} hazır</span>
          </div>

          <ul className="space-y-1">
            {[{ id: row.white_id, name: row.white_name, side: "Beyaz" }, { id: row.black_id, name: row.black_name, side: "Siyah" }].map((pl) => {
              const pr = peers.find((p) => p.user_id === pl.id);
              return (
                <li key={pl.id} className="flex items-center justify-between rounded-lg bg-black/30 px-2.5 py-1.5 text-xs">
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${pr ? "bg-emerald-400" : "bg-neutral-600"}`} />
                    <span className="font-medium">{pr?.avatar ?? "♟"} {pl.name}</span>
                    <span className="text-neutral-500">· {pl.side}</span>
                    {pl.id === me.id && <span className="text-neutral-500">(sen)</span>}
                  </span>
                  <span className={pr ? (pr.ready ? "text-emerald-400" : "text-amber-400") : "text-neutral-500"}>
                    {pr ? (pr.ready ? "✅ Hazır" : "⏳ Bekliyor") : "⚪ Çevrimdışı"}
                  </span>
                </li>
              );
            })}
          </ul>

          {!finished && myColor && (
            <button
              onClick={toggleReady}
              className={`w-full rounded-xl px-3 py-2 text-xs font-semibold ${
                ready ? "bg-emerald-600 hover:bg-emerald-500" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              {ready ? "✅ Hazırım (iptal için tıkla)" : "Hazırım"}
            </button>
          )}
        </div>



        <div className="w-full max-w-md">
          <Chessboard
            options={{
              position: row.fen,
              boardOrientation: iAmBlack ? "black" : "white",
              allowDragging: !!myTurn,
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!targetSquare) return false;
                void tryMove(sourceSquare, targetSquare);
                return true;
              },
            }}
          />
        </div>

        <div className="mt-3 text-center text-sm text-neutral-300">
          {finished ? (
            <span className="font-bold text-lg">
              {won ? "🏆 Kazandın!" : lost ? "💀 Kaybettin" : drew ? "🤝 Berabere" : "Bitti"}
            </span>
          ) : myTurn ? (
            <span className="text-emerald-400">Sıra sende</span>
          ) : (
            <span className="text-neutral-400">Rakip düşünüyor…</span>
          )}
        </div>

        {!finished && myColor && (
          <button onClick={resign} className="mt-3 rounded-full bg-red-600/80 hover:bg-red-600 px-4 py-1.5 text-xs font-semibold">
            Teslim ol
          </button>
        )}
      </div>

      <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col max-h-[50vh] lg:max-h-none">
        <div className="p-3 border-b border-white/10 font-semibold">💬 Sohbet</div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
          {gameChat.map((m) => (
            <div key={m.id} className={m.user_id === me.id ? "text-right" : ""}>
              <div className="text-xs text-neutral-400">{m.display_name}</div>
              <div className={`inline-block rounded-2xl px-3 py-1.5 ${m.user_id === me.id ? "bg-blue-600" : "bg-white/10"}`}>
                {m.content}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={sendChat} className="p-2 border-t border-white/10 flex gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Mesaj…"
            maxLength={400}
            className="flex-1 rounded-full bg-white/10 px-3 py-1.5 text-sm outline-none"
          />
          <button className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-semibold">Gönder</button>
        </form>
      </aside>
    </div>
  );
}
