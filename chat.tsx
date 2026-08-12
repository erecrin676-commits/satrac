import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Global Sohbet — Satranç Grandmaster" },
      { name: "description", content: "Tüm oyuncularla anlık sohbet." },
    ],
  }),
  component: ChatPage,
});

type Msg = {
  id: string;
  user_id: string;
  display_name: string;
  avatar: string;
  content: string;
  created_at: string;
};

function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [me, setMe] = useState<{ id: string; name: string; avatar: string } | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, avatar")
        .eq("id", u.user.id)
        .maybeSingle();
      setMe({
        id: u.user.id,
        name: prof?.display_name ?? "Oyuncu",
        avatar: prof?.avatar ?? "♟",
      });
    })();
  }, []);

  useEffect(() => {
    supabase
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => setMsgs((data ?? []) as Msg[]));

    const ch = supabase
      .channel("chat_messages_room")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => setMsgs((m) => [...m, payload.new as Msg]),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !text.trim() || sending) return;
    setSending(true);
    const content = text.trim().slice(0, 500);
    setText("");
    const { error } = await supabase.from("chat_messages").insert({
      user_id: me.id,
      display_name: me.name,
      avatar: me.avatar,
      content,
    });
    if (error) setText(content);
    setSending(false);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">
      <header className="flex items-center justify-between p-3 border-b border-white/10">
        <h1 className="font-bold">💬 Global Sohbet</h1>
        <Link to="/" className="text-sm text-neutral-400 hover:text-white">← Oyun</Link>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {msgs.map((m) => {
          const mine = m.user_id === me?.id;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? "justify-end" : ""}`}>
              {!mine && <span className="text-xl">{m.avatar}</span>}
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-blue-600" : "bg-white/10"}`}>
                {!mine && <div className="text-xs font-semibold opacity-80">{m.display_name}</div>}
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            </div>
          );
        })}
        {msgs.length === 0 && (
          <p className="text-center text-neutral-500 mt-8">İlk mesajı sen yaz 👋</p>
        )}
      </div>

      <form onSubmit={send} className="flex gap-2 p-3 border-t border-white/10">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mesaj yaz…"
          maxLength={500}
          className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none focus:bg-white/15"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Gönder
        </button>
      </form>
    </div>
  );
}
