import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Clock className="h-4 w-4" />
            </div>
            <span className="font-semibold">Auto Clock-In</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/dashboard"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              activeProps={{ className: "rounded-md px-3 py-1.5 bg-accent text-foreground font-medium" }}
            >
              Dashboard
            </Link>
            <Link
              to="/settings"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              activeProps={{ className: "rounded-md px-3 py-1.5 bg-accent text-foreground font-medium" }}
            >
              Settings
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => supabase.auth.signOut()}
              className="ml-2"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
