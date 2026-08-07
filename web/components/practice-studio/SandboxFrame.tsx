"use client";

import { ShieldCheck } from "lucide-react";
import { useMemo } from "react";

/**
 * 沙箱模式：把 AI 现场生成的 HTML 放进隔离 iframe 运行。
 * - sandbox="allow-scripts" 但不含 allow-same-origin → 无法访问父页面 / cookie / storage。
 * - CSP default-src 'none' → 禁止一切网络请求（无外泄、无外部资源）。
 */
export function SandboxFrame({ html }: { html: string }) {
  const srcDoc = useMemo(() => buildDoc(html), [html]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        此界面由 AI 现场生成，运行在隔离沙箱中（无网络访问）。
      </div>
      <iframe
        title="AI 定制练习"
        sandbox="allow-scripts allow-pointer-lock"
        srcDoc={srcDoc}
        className="h-[600px] w-full rounded-2xl border border-border bg-white"
      />
    </div>
  );
}

function buildDoc(inner: string): string {
  const csp =
    "default-src 'none'; " +
    "style-src 'unsafe-inline'; " +
    "script-src 'unsafe-inline' 'unsafe-eval'; " +
    "img-src data: blob:; " +
    "font-src data:; " +
    "media-src data: blob:;";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #0f172a; background: #ffffff; line-height: 1.5;
  }
  button { font: inherit; cursor: pointer; }
</style>
</head>
<body>
${inner}
</body>
</html>`;
}
