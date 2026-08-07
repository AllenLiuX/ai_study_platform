"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

interface Section {
  key: string;
  title: string;
  tip: string;
  placeholder: string;
}

const SECTIONS: Section[] = [
  {
    key: "thesis",
    title: "中心论点",
    tip: "一句话亮明观点，鲜明可辩",
    placeholder: "如：真正的勇敢，是明知困难仍选择坚持。",
  },
  {
    key: "p1",
    title: "分论点一",
    tip: "从「是什么」角度立论",
    placeholder: "勇敢是……",
  },
  {
    key: "p2",
    title: "分论点二",
    tip: "从「为什么」角度深入",
    placeholder: "因为……所以需要勇敢",
  },
  {
    key: "p3",
    title: "分论点三",
    tip: "从「怎么做」角度落地",
    placeholder: "我们应当如何……",
  },
  {
    key: "evidence",
    title: "典型论据",
    tip: "名人事例 / 名言 / 时事，注意点面结合",
    placeholder: "苏武牧羊；居里夫人；……",
  },
  {
    key: "end",
    title: "结尾升华",
    tip: "回扣论点 + 联系现实 / 号召",
    placeholder: "由此可见……愿我们……",
  },
];

const STORAGE_KEY = "chinese-essay-v1";

/** 议论文提纲 widget：结构化搭框架 + 一键复制。 */
export function EssayOutline() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setValues(JSON.parse(raw) as Record<string, string>);
    } catch {
      /* ignore */
    }
  }, []);

  function update(key: string, text: string) {
    const next = { ...values, [key]: text };
    setValues(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const assembled = SECTIONS.map((s) => {
    const body = (values[s.key] ?? "").trim();
    return body ? `【${s.title}】${body}` : "";
  })
    .filter(Boolean)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(assembled);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">作文提纲 · 议论文</h3>
        <Button size="sm" variant="secondary" onClick={copy} disabled={!assembled}>
          {copied ? (
            <Check className="mr-1 h-3.5 w-3.5" />
          ) : (
            <Copy className="mr-1 h-3.5 w-3.5" />
          )}
          {copied ? "已复制" : "复制提纲"}
        </Button>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <div key={s.key}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-medium">{s.title}</span>
              <span className="text-[11px] text-muted-foreground">{s.tip}</span>
            </div>
            <textarea
              value={values[s.key] ?? ""}
              onChange={(e) => update(s.key, e.target.value)}
              placeholder={s.placeholder}
              rows={2}
              className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        按「论点—分论点—论据—升华」搭好骨架，行文自然有条理；内容自动本地保存。
      </p>
    </div>
  );
}
