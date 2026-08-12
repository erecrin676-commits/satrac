import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile } from "@/lib/profile.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profilim — Satranç Grandmaster" },
      { name: "description", content: "Satranç istatistikleriniz, en yüksek Elo dereceniz ve son maçlarınız." },
      { property: "og:title", content: "Profilim — Satranç Grandmaster" },
      { property: "og:description", content: "Kişisel satranç istatistikleriniz ve derece geçmişiniz." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

type MatchRow = {
  result?: string;
  mode?: string;
  date?: string;
  moves?: number;
  delta?: number;
  elo?: number;
};

function rankTitle(elo: number) {
  const ranks: [number, string][] = [
    [0, "Acemi"], [800, "Klüp"], [1200, "Yetkin"], [1500, "Uzman"],
    [1800, "Usta"], [2100, "Grandmaster"], [2500, "Süper GM"],
  ];
  let r = "Acemi";
  for (const [t, name] of ranks) if (elo >= t) r = name;
  return r;
}

function ProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
    refetchOnWindowFocus: true,
  });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Yükleniyor…
      </div>
    );
  }

  const history = (profile.match_history as MatchRow[] | null) ?? [];
  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between p-4">
          <Link to="/" className="font-bold">← Oyuna dön</Link>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>Çıkış yap</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        <Card className="p-6 flex items-center gap-4">
          <div className="text-5xl">{profile.avatar}</div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{profile.display_name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge>{rankTitle(profile.elo)}</Badge>
              <span className="text-sm text-muted-foreground">Elo: {profile.elo}</span>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="En yüksek Elo" value={profile.best_elo} />
          <StatCard label="Galibiyet" value={profile.wins} tone="win" />
          <StatCard label="Beraberlik" value={profile.draws} />
          <StatCard label="Mağlubiyet" value={profile.losses} tone="loss" />
          <StatCard label="Kazanma oranı" value={`${winRate}%`} />
          <StatCard label="Bulmaca" value={profile.puzzles} />
          <StatCard
            label="En hızlı mat"
            value={profile.fastest_mate ? `${profile.fastest_mate} hamle` : "—"}
          />
          <StatCard label="Toplam maç" value={total} />
        </div>

        <Card className="p-6">
          <h2 className="font-semibold mb-3">Son maçlar</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz maç oynanmadı. Oyuna dönüp başla!</p>
          ) : (
            <ul className="divide-y">
              {[...history].reverse().slice(0, 15).map((m, i) => (
                <li key={i} className="py-2 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className={
                      m.result === "Galibiyet" ? "text-green-500 font-medium"
                      : m.result === "Mağlubiyet" ? "text-red-500 font-medium"
                      : "text-muted-foreground font-medium"
                    }>{m.result ?? "—"}</span>
                    <span className="text-muted-foreground">{m.mode}</span>
                    <span className="text-muted-foreground">{m.moves} hamle</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {typeof m.delta === "number" && m.delta !== 0 && (
                      <span className={m.delta > 0 ? "text-green-500" : "text-red-500"}>
                        {m.delta > 0 ? "+" : ""}{m.delta}
                      </span>
                    )}
                    <span>{m.date}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          İstatistikler oyun oynadıkça otomatik olarak buluta kaydedilir.
        </p>
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "win" | "loss" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={
        "text-2xl font-bold mt-1 " +
        (tone === "win" ? "text-green-500" : tone === "loss" ? "text-red-500" : "")
      }>{value}</div>
    </Card>
  );
}
