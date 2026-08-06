import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// 🔴 서버 전용입니다. 'use client' 파일에서 절대 import하지 마세요.
// service_role 키는 RLS를 우회합니다. kis_tokens·event_logs처럼
// 로그인 여부와 무관하게 서버만 접근해야 하는 테이블에만 씁니다.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
