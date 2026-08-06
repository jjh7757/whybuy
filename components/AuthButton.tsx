"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function AuthButton() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      },
    );

    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  if (loading) {
    return <div className="h-9 w-32 animate-pulse rounded bg-neutral-200" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-neutral-600">{user.email}</span>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100"
        >
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() =>
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${location.origin}/auth/callback` },
        })
      }
      className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
    >
      Google로 계속하기
    </button>
  );
}
