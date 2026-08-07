"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

interface Line {
  prompt: string; // 上句
  answer: string; // 下句
  source: string; // 作者·出处
}

const LINES: Line[] = [
  { prompt: "会当凌绝顶", answer: "一览众山小", source: "杜甫《望岳》" },
  { prompt: "海内存知己", answer: "天涯若比邻", source: "王勃《送杜少府之任蜀州》" },
  { prompt: "欲穷千里目", answer: "更上一层楼", source: "王之涣《登鹳雀楼》" },
  { prompt: "独在异乡为异客", answer: "每逢佳节倍思亲", source: "王维《九月九日忆山东兄弟》" },
  { prompt: "落红不是无情物", answer: "化作春泥更护花", source: "龚自珍《己亥杂诗》" },
  { prompt: "山重水复疑无路", answer: "柳暗花明又一村", source: "陆游《游山西村》" },
  { prompt: "沉舟侧畔千帆过", answer: "病树前头万木春", source: "刘禹锡《酬乐天扬州初逢席上见赠》" },
  { prompt: "长风破浪会有时", answer: "直挂云帆济沧海", source: "李白《行路难》" },
  { prompt: "千磨万击还坚劲", answer: "任尔东西南北风", source: "郑燮《竹石》" },
  { prompt: "野火烧不尽", answer: "春风吹又生", source: "白居易《赋得古原草送别》" },
];

function shuffled(): number[] {
  const idx = LINES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/** 古诗文名句默写 widget：看上句默下句，自评巩固。 */
export function PoemDictation() {
  const [order, setOrder] = useState<number[]>(() => shuffled());
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [remembered, setRemembered] = useState(0);
  const [reviewed, setReviewed] = useState(0);

  const line = useMemo(() => LINES[order[pos]], [order, pos]);
  const done = pos >= order.length;

  function grade(ok: boolean) {
    setReviewed((r) => r + 1);
    if (ok) setRemembered((r) => r + 1);
    setPos((p) => p + 1);
    setRevealed(false);
  }

  function restart() {
    setOrder(shuffled());
    setPos(0);
    setRevealed(false);
    setRemembered(0);
    setReviewed(0);
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">古诗文名句默写</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {Math.min(pos + (done ? 0 : 1), order.length)}/{order.length}
          </span>
          <Button size="sm" variant="ghost" onClick={restart}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            重来
          </Button>
        </div>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/40 py-10 text-center">
          <p className="text-sm font-medium">
            本轮完成 · 记住 {remembered}/{reviewed}
          </p>
          <Button size="sm" variant="secondary" onClick={restart}>
            再来一轮
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-background/60 p-6 text-center">
            <div className="text-xl font-medium tracking-wide">{line.prompt}，</div>
            {revealed ? (
              <div className="mt-3 space-y-1">
                <div className="text-xl font-semibold text-primary">
                  {line.answer}。
                </div>
                <div className="text-xs text-muted-foreground">
                  —— {line.source}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-muted-foreground">
                回忆下一句……
              </div>
            )}
          </div>

          {!revealed ? (
            <Button className="mt-4 w-full" onClick={() => setRevealed(true)}>
              显示下句
            </Button>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => grade(false)}
                className="rounded-xl border border-rose-300 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                没记住
              </button>
              <button
                type="button"
                onClick={() => grade(true)}
                className="rounded-xl border border-emerald-300 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                记住了
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
