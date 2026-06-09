import "./globals.css";
import "katex/dist/katex.min.css";

import type { Metadata, Viewport } from "next";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "学生学习驾驶舱 · AI Study Coach",
  description:
    "面向中国初高中学生的 AI 学习平台。班主任 Agent 帮你规划,各科老师 Agent 负责讲解,陪你一起把每一次提问变成下一次更个性化的学习建议。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
