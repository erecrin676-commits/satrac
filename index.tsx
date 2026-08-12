import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { upsertMyStats, getMyProfile } from "@/lib/profile.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Satranç Grandmaster" },
      { name: "description", content: "Tarayıcıda oynanan Satranç Grandmaster oyunu." },
      { property: "og:title", content: "Satranç Grandmaster" },
      { property: "og:description", content: "Tarayıcıda oynanan Satranç Grandmaster oyunu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GamePage,
});

type GmProfile = {
  name?: string;
  avatar?: string;
  elo?: number;
  best?: number;
  wins?: number;
  losses?: number;
  puzzles?: number;
  matchHistory?: Array<{ result?: string; moves?: number }>;
};

function GamePage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const upsert = useServerFn(upsertMyStats);
  const fetchProfile = useServerFn(getMyProfile);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSyncRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track auth state.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    lastSyncRef.current = "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await supabase.auth.signOut();
    setSignedIn(false);
  }


  // On sign-in, pull cloud profile and push it into iframe's localStorage (merged with local).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const cloud = await fetchProfile();
        if (cancelled || !cloud) return;
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        try {
          const raw = iframe.contentWindow.localStorage.getItem("gm_profile_v3");
          const local = raw ? JSON.parse(raw) : {};
          const merged = {
            ...local,
            name: cloud.display_name ?? local.name,
            avatar: cloud.avatar ?? local.avatar,
            elo: Math.max(local.elo ?? 0, cloud.elo ?? 0),
            best: Math.max(local.best ?? 0, cloud.best_elo ?? 0),
            wins: Math.max(local.wins ?? 0, cloud.wins ?? 0),
            losses: Math.max(local.losses ?? 0, cloud.losses ?? 0),
            puzzles: Math.max(local.puzzles ?? 0, cloud.puzzles ?? 0),
            matchHistory: (cloud.match_history as unknown[])?.length
              ? cloud.match_history
              : local.matchHistory ?? [],
          };
          iframe.contentWindow.localStorage.setItem("gm_profile_v3", JSON.stringify(merged));
        } catch {
          /* cross-origin or storage blocked */
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, fetchProfile]);

  // Listen for profile updates broadcast by the game and sync to cloud.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data;
      if (!data || data.type !== "gm_profile_update" || !data.profile) return;
      if (!signedIn) return;
      const p = data.profile as GmProfile;
      const key = JSON.stringify([p.elo, p.best, p.wins, p.losses, p.matchHistory?.length]);
      if (key === lastSyncRef.current) return;
      lastSyncRef.current = key;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const history = (p.matchHistory ?? []).slice(-50);
        const wins = history.filter((m) => m.result === "Galibiyet");
        const fastestMate = wins.length
          ? Math.min(...wins.map((m) => m.moves ?? 999).filter((n) => n > 0))
          : null;
        const draws = history.filter((m) => m.result === "Berabere").length;
        void upsert({
          data: {
            display_name: p.name || "Oyuncu",
            avatar: p.avatar || "♟",
            elo: p.elo ?? 1000,
            best_elo: p.best ?? p.elo ?? 1000,
            wins: p.wins ?? 0,
            losses: p.losses ?? 0,
            draws,
            puzzles: p.puzzles ?? 0,
            fastest_mate: fastestMate && Number.isFinite(fastestMate) ? fastestMate : null,
            match_history: history,
          },
        }).catch(() => {});
      }, 1500);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [signedIn, upsert]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <iframe
        ref={iframeRef}
        src="/game.html"
        title="Satranç Grandmaster"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        allow="fullscreen; autoplay"
      />
      <div
        style={{
          position: "fixed",
          top: 8,
          right: 8,
          zIndex: 50,
          display: "flex",
          gap: 6,
        }}
      >
        <Link
          to="/leaderboard"
          className="rounded-full bg-black/70 text-white text-xs font-medium px-3 py-1.5 backdrop-blur hover:bg-black/85"
        >
          🏆 Liderlik
        </Link>
        {signedIn ? (
          <>
            <Link
              to="/online"
              className="rounded-full bg-blue-600/90 text-white text-xs font-medium px-3 py-1.5 backdrop-blur hover:bg-blue-500"
            >
              ♟ Online
            </Link>
            <Link
              to="/chat"
              className="rounded-full bg-black/70 text-white text-xs font-medium px-3 py-1.5 backdrop-blur hover:bg-black/85"
            >
              💬 Sohbet
            </Link>
            <Link
              to="/profile"
              className="rounded-full bg-black/70 text-white text-xs font-medium px-3 py-1.5 backdrop-blur hover:bg-black/85"
            >
              Profilim
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-full bg-black/70 text-white text-xs font-medium px-3 py-1.5 backdrop-blur hover:bg-black/85"
            >
              Çıkış
            </button>
          </>

        ) : signedIn === false ? (
          <Link
            to="/auth"
            className="rounded-full bg-black/70 text-white text-xs font-medium px-3 py-1.5 backdrop-blur hover:bg-black/85"
          >
            Giriş / Kayıt
          </Link>
        ) : null}
      </div>
    </div>
  );
}
