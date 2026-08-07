"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Verb {
  base: string;
  past: string;
  pp: string;
  meaning: string;
}

const VERBS: Verb[] = [
  { base: "be", past: "was/were", pp: "been", meaning: "是" },
  { base: "begin", past: "began", pp: "begun", meaning: "开始" },
  { base: "break", past: "broke", pp: "broken", meaning: "打破" },
  { base: "bring", past: "brought", pp: "brought", meaning: "带来" },
  { base: "choose", past: "chose", pp: "chosen", meaning: "选择" },
  { base: "come", past: "came", pp: "come", meaning: "来" },
  { base: "do", past: "did", pp: "done", meaning: "做" },
  { base: "eat", past: "ate", pp: "eaten", meaning: "吃" },
  { base: "give", past: "gave", pp: "given", meaning: "给" },
  { base: "go", past: "went", pp: "gone", meaning: "去" },
  { base: "know", past: "knew", pp: "known", meaning: "知道" },
  { base: "take", past: "took", pp: "taken", meaning: "拿" },
  { base: "write", past: "wrote", pp: "written", meaning: "写" },
];

/** 不规则动词特训 widget：测验模式隐藏答案，逐行点开自评。 */
export function IrregularVerbs() {
  const [quiz, setQuiz] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  function toggleRow(i: number) {
    if (!quiz) return;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleQuiz() {
    setQuiz((q) => !q);
    setOpen(new Set());
  }

  const hidden = (i: number) => quiz && !open.has(i);

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">不规则动词特训</h3>
        <Button size="sm" variant={quiz ? "default" : "secondary"} onClick={toggleQuiz}>
          {quiz ? (
            <Eye className="mr-1 h-3.5 w-3.5" />
          ) : (
            <EyeOff className="mr-1 h-3.5 w-3.5" />
          )}
          {quiz ? "退出测验" : "测验模式"}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">原形</th>
              <th className="px-3 py-2 text-left font-medium">过去式</th>
              <th className="px-3 py-2 text-left font-medium">过去分词</th>
              <th className="px-3 py-2 text-left font-medium">释义</th>
            </tr>
          </thead>
          <tbody>
            {VERBS.map((v, i) => (
              <tr
                key={v.base}
                onClick={() => toggleRow(i)}
                className={cn(
                  "border-t border-border transition",
                  quiz && "cursor-pointer hover:bg-secondary/60",
                  quiz && open.has(i) && "bg-emerald-50/60",
                )}
              >
                <td className="px-3 py-2 font-medium">{v.base}</td>
                <td className="px-3 py-2">
                  <Cell text={v.past} hidden={hidden(i)} />
                </td>
                <td className="px-3 py-2">
                  <Cell text={v.pp} hidden={hidden(i)} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{v.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {quiz
          ? "先默念过去式 / 过去分词，点行揭晓答案自评。"
          : "开启「测验模式」隐藏变形，检验你是否真的记住。"}
      </p>
    </div>
  );
}

function Cell({ text, hidden }: { text: string; hidden: boolean }) {
  if (hidden) {
    return (
      <span className="inline-block h-4 w-16 rounded bg-muted-foreground/20 align-middle" />
    );
  }
  return <span>{text}</span>;
}
