"use client";

import { WIDGETS, type WidgetType } from "@/lib/widgets/registry";

/**
 * 按 widget 类型从注册表取出组件并渲染（编排层入口）。
 * 未来学习规划节点只需给出 type 列表，即可动态组装出交互界面。
 */
export function WidgetRenderer({ type }: { type: WidgetType }) {
  const def = WIDGETS[type];
  if (!def) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        未注册的组件：{type}
      </div>
    );
  }
  const Comp = def.component;
  return <Comp />;
}
