// 🔴 서버 전용입니다. 'use client' 파일에서 import하면 빌드가 실패합니다.
// 주석만으로는 강제가 안 돼서 lib/dart.ts·news.ts·portfolio.ts와 같은 가드를 답니다 —
// service_role 키가 브라우저 번들에 들어가는 사고는 되돌릴 수 없습니다.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
