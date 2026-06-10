"use client";

/**
 * 聊天消息的 Markdown 渲染器。
 *
 * - GFM (表格 / 任务列表 / 删除线 / 自动链接)
 * - LaTeX 公式 ($x^2$ 与 $$\frac{a}{b}$$),数学老师必备
 * - 流式增量友好:react-markdown 会优雅处理未闭合的列表/代码块
 * - 两种主题:`assistant` 用浅色气泡内的 prose; `user` 用反色气泡
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";

interface MarkdownMessageProps {
  content: string;
  variant?: "assistant" | "user";
  className?: string;
}

/**
 * 把 LLM 输出里的 `\(...\)` `\[...\]` 这种 KaTeX 风格分隔符 normalize 成
 * remark-math 能识别的 `$...$` / `$$...$$`。
 *
 * 为什么需要这一步:markdown 解析时反斜杠是转义字符,`\[` 会被吞成 `[`,
 * 反而吃掉 math 分隔符,导致公式被显示为纯文本(参见 bug:"markdown 显示
 * 的公式显示的是原始 string,没有渲染")。
 *
 * 跳过 fenced code (```...```) 和 inline code (`...`),避免改坏代码示例。
 */
function normalizeMathDelimiters(input: string): string {
  let out = "";
  let i = 0;
  let inFenced = false;
  let inInline = false;
  while (i < input.length) {
    if (!inInline && input.startsWith("```", i)) {
      inFenced = !inFenced;
      out += "```";
      i += 3;
      continue;
    }
    if (!inFenced && input[i] === "`") {
      inInline = !inInline;
      out += "`";
      i += 1;
      continue;
    }
    if (!inFenced && !inInline && input[i] === "\\") {
      const next = input[i + 1];
      if (next === "[" || next === "]") {
        out += "$$";
        i += 2;
        continue;
      }
      if (next === "(" || next === ")") {
        out += "$";
        i += 2;
        continue;
      }
    }
    out += input[i];
    i += 1;
  }
  return out;
}

function MarkdownMessageImpl({
  content,
  variant = "assistant",
  className,
}: MarkdownMessageProps) {
  const normalized = normalizeMathDelimiters(content);
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words",
        // 让 prose 跟随气泡颜色:user 气泡是 primary 反色,assistant 是 foreground
        variant === "user"
          ? "prose-invert text-primary-foreground prose-strong:text-primary-foreground prose-headings:text-primary-foreground prose-code:text-primary-foreground"
          : "text-foreground prose-headings:text-foreground prose-strong:text-foreground",
        "prose-p:my-2 prose-p:leading-relaxed",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-1",
        "prose-h1:text-base prose-h2:text-base prose-h3:text-sm",
        "prose-h1:font-semibold prose-h2:font-semibold prose-h3:font-semibold",
        "prose-blockquote:my-2 prose-blockquote:border-l-2 prose-blockquote:py-0",
        "prose-code:rounded prose-code:bg-black/5 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:hidden prose-code:after:hidden",
        "prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:bg-slate-900/90 prose-pre:text-slate-50",
        "prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1",
        "prose-hr:my-3",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 外链统一新页签打开 + 防 referrer 泄漏
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              {children}
            </a>
          ),
          // 内联引用角标 [1] [2] 视觉强化
          // react-markdown 会把 [1] 当成普通文字渲染,这里靠 CSS 自动处理即可
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(
  MarkdownMessageImpl,
  (prev, next) =>
    prev.content === next.content &&
    prev.variant === next.variant &&
    prev.className === next.className,
);
