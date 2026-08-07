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
    key: "hook",
    title: "开场留人",
    tip: "3 秒抓注意力：福利预告 / 制造好奇",
    placeholder: "家人们别走！今天这款…只在直播间…",
  },
  {
    key: "pain",
    title: "痛点共鸣",
    tip: "描述目标用户的真实困扰",
    placeholder: "是不是每次都遇到…特别烦…",
  },
  {
    key: "selling",
    title: "产品卖点",
    tip: "3 个核心卖点 + 使用场景",
    placeholder: "第一…第二…第三…",
  },
  {
    key: "trust",
    title: "信任背书",
    tip: "销量 / 资质 / 真实反馈 / 演示",
    placeholder: "已经卖出 X 万单，看这个检测报告…",
  },
  {
    key: "anchor",
    title: "价格锚点",
    tip: "对比原价 / 全网价，凸显划算",
    placeholder: "专柜价 X，今天直播间只要…",
  },
  {
    key: "close",
    title: "促单逼单",
    tip: "限时 / 限量 / 赠品，制造紧迫感",
    placeholder: "只有 100 单，上链接，3、2、1…",
  },
];

const STORAGE_KEY = "commerce-script-v1";

/** 直播话术脚本 widget：结构化模板 + 一键复制。 */
export function ScriptBuilder() {
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
    return body ? `【${s.title}】\n${body}` : "";
  })
    .filter(Boolean)
    .join("\n\n");

  const words = assembled.replace(/\s/g, "").length;

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
        <h3 className="text-sm font-semibold tracking-tight">直播话术脚本</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{words} 字</span>
          <Button size="sm" variant="secondary" onClick={copy} disabled={!assembled}>
            {copied ? (
              <Check className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            {copied ? "已复制" : "复制脚本"}
          </Button>
        </div>
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
        按「留人→共鸣→卖点→信任→价格→逼单」结构填写，内容自动保存在本地，可一键复制去开播。
      </p>
    </div>
  );
}
