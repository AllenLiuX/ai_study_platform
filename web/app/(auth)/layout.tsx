import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-app-gradient">
      <div className="container flex min-h-screen flex-col">
        <header className="py-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl">🧭</span>
            <span className="text-lg font-semibold tracking-tight">
              学生学习驾驶舱
            </span>
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center pb-16">
          <div className="w-full max-w-md animate-fade-in">{children}</div>
        </main>
        <footer className="py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} AI Study Coach · 你的课后 AI 学习伙伴
        </footer>
      </div>
    </div>
  );
}
