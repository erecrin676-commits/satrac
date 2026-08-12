import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => {
    const r = typeof search.redirect === "string" ? search.redirect : "";
    // Yalnızca uygulama içi göreli yollara izin ver (open redirect koruması).
    const safe = r.startsWith("/") && !r.startsWith("//") ? r : "";
    return { redirect: safe || undefined } as { redirect?: string };
  },
  head: () => ({
    meta: [
      { title: "Giriş — Satranç Grandmaster" },
      { name: "description", content: "Satranç Grandmaster hesabınıza giriş yapın veya kayıt olun." },
      { property: "og:title", content: "Giriş — Satranç Grandmaster" },
      { property: "og:description", content: "İstatistiklerinizi ve derecelerinizi bulutta saklayın." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const target = redirectTo || "/profile";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      navigate({ to: target, replace: true });
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) go();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) go();
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, target]);


  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Hesap oluşturuldu. E-postanı kontrol et.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: target, replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri:
          window.location.origin +
          "/auth" +
          (redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""),
      });
      if (result.error) {
        toast.error("Google girişi başarısız. Lütfen tekrar dene.");
        setLoading(false);
        return;
      }
      // Tam sayfa yönlendirme: dönüşte oturum dinleyicisi devralır.
      if (result.redirected) return;

      // Popup akışı: oturumun yazılmasını bekle.
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        navigate({ to: target, replace: true });
      } else {
        setLoading(false);
      }
    } catch {
      toast.error("Google girişi başarısız. Lütfen tekrar dene.");
      setLoading(false);
    }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Satranç Grandmaster</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" ? "Hesabına giriş yap" : "Yeni hesap oluştur"}
          </p>
        </div>

        <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
          Google ile devam et
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">veya</span>
          </div>
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Görünen ad</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Oyuncu" />
            </div>
          )}
          <div>
            <Label htmlFor="email">E-posta</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Şifre</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {mode === "signin" ? "Giriş yap" : "Kayıt ol"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
        </button>

        <div className="text-center">
          <a href="/" className="text-xs text-muted-foreground hover:underline">← Oyuna geri dön</a>
        </div>
      </Card>
    </div>
  );
}
