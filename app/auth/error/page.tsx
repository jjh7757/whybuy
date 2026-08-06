export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">로그인에 실패했습니다</h1>
      <p className="text-sm text-neutral-500">
        잠시 후 다시 시도해주세요. 문제가 계속되면 페이지를 새로고침해보세요.
      </p>
      <a href="/" className="text-blue-600 underline">
        처음으로 돌아가기
      </a>
    </main>
  );
}
