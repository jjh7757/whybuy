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
    return <div className="h-8 w-24 shrink-0 animate-pulse rounded-lg bg-neutral-200" />;
  }

  if (user) {
    return (
      <div className="flex shrink-0 items-center gap-2 text-sm">
        {/* 좁은 화면에서는 주소가 내비게이션을 밀어냅니다. 로그아웃 버튼만 남깁니다. */}
        <span className="hidden max-w-40 truncate text-neutral-500 lg:inline">
          {user.email}
        </span>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 font-medium text-neutral-600 transition hover:bg-neutral-100"
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
      className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700"
    >
      로그인
    </button>
  );
}
