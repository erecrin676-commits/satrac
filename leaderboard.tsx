import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLeaderboard } from "@/lib/matchmaking.functions";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Liderlik Tablosu — Satranç Grandmaster" },
      { name: "description", content: "Tüm oyuncuların Elo sıralaması." },
      { property: "og:title", content: "Liderlik Tablosu" },
      { property: "og:description", content: "En yüksek Elo'ya sahip satranç oyuncuları." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeaderboardPage,
});

type Row = {
  id: string;
  display_name: string;
  avatar: string;
  elo: number;
  best_elo: number;
  wins: number;
  losses: number;
  draws: number;
};

type SortKey = "elo" | "best_elo" | "wins" | "winrate" | "games" | "name";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "elo", label: "Elo" },
  { key: "best_elo", label: "Rekor Elo" },
  { key: "wins", label: "Galibiyet" },
  { key: "winrate", label: "Kazanma %" },
  { key: "games", label: "Maç sayısı" },
  { key: "name", label: "İsim" },
];

const games = (r: Row) => r.wins + r.losses + r.draws;
const winrate = (r: Row) => (games(r) ? (r.wins / games(r)) * 100 : 0);

function LeaderboardPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("elo");
  const [asc, setAsc] = useState(false);
  const fetchLeaderboard = useServerFn(getLeaderboard);

  useEffect(() => {
    fetchLeaderboard()
      .then((data) => setRows(data))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [fetchLeaderboard]);

  // Elo sıralaması her zaman tam listeye göre — filtre sadece görünürlüğü değiştirir.
  const ranked = useMemo(() => {
    if (!rows) return null;
    const byElo = [...rows].sort((a, b) => b.elo - a.elo || b.wins - a.wins);
    const rankMap = new Map<string, number>();
    byElo.forEach((r, i) => {
      const prev = byElo[i - 1];
      rankMap.set(r.id, prev && prev.elo === r.elo ? rankMap.get(prev.id)! : i + 1);
    });
    return rows.map((r) => ({ ...r, rank: rankMap.get(r.id)! }));
  }, [rows]);

  const visible = useMemo(() => {
    if (!ranked) return null;
    const q = query.trim().toLocaleLowerCase("tr");
    const filtered = q
      ? ranked.filter((r) => r.display_name.toLocaleLowerCase("tr").includes(q))
      : ranked;
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.display_name.localeCompare(b.display_name, "tr") * (asc ? 1 : -1);
        case "winrate":
          return (winrate(a) - winrate(b)) * dir || a.rank - b.rank;
        case "games":
          return (games(a) - games(b)) * dir || a.rank - b.rank;
        case "wins":
          return (a.wins - b.wins) * dir || a.rank - b.rank;
        case "best_elo":
          return (a.best_elo - b.best_elo) * dir || a.rank - b.rank;
        default:
          return (a.elo - b.elo) * dir || a.rank - b.rank;
      }
    });
  }, [ranked, query, sortKey, asc]);

  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null);

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold">🏆 Liderlik Tablosu</h1>
          <Link to="/" className="text-sm text-neutral-400 hover:text-white">← Oyuna dön</Link>
        </div>
        <p className="text-sm text-neutral-400 mb-5">
          Sıra numarası her zaman Elo puanına göredir. Aşağıdan oyuncu arayabilir, listeyi farklı
          ölçütlere göre sıralayabilirsin.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Oyuncu ara…"
            aria-label="Oyuncu ara"
            className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-sm outline-none focus:border-white/30 placeholder:text-neutral-500"
          />
          <div className="flex gap-2">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sıralama ölçütü"
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-white/30"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key} className="bg-neutral-900">
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setAsc((v) => !v)}
              aria-label="Sıralama yönünü değiştir"
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm hover:bg-white/10"
            >
              {asc ? "↑ Artan" : "↓ Azalan"}
            </button>
          </div>
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}
        {!rows && !err && <p className="text-neutral-400">Yükleniyor…</p>}
        {rows && rows.length === 0 && (
          <p className="text-neutral-400">Henüz oyuncu yok. İlk siz olun!</p>
        )}
        {visible && rows && rows.length > 0 && (
          <p className="text-xs text-neutral-500 mb-2">
            {visible.length} / {rows.length} oyuncu gösteriliyor
          </p>
        )}
        {visible && visible.length === 0 && rows && rows.length > 0 && (
          <p className="text-neutral-400">“{query}” için sonuç bulunamadı.</p>
        )}

        {visible && visible.length > 0 && (
          <ul className="divide-y divide-white/10 rounded-2xl bg-white/5 backdrop-blur overflow-hidden">
            {visible.map((r) => {
              const total = games(r);
              const wr = Math.round(winrate(r));
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`w-8 text-center font-bold ${r.rank <= 3 ? "text-yellow-400" : "text-neutral-400"}`}>
                    {medal(r.rank) ?? r.rank}
                  </span>
                  <span className="text-2xl">{r.avatar || "♟"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-semibold">{r.display_name}</div>
                    <div className="text-xs text-neutral-400">
                      {total} maç · {r.wins}G / {r.draws}B / {r.losses}M · %{wr} kazanma
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">{r.elo}</div>
                    <div className="text-xs text-neutral-400">rekor {r.best_elo}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

