"use client";

import { Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMeta } from "@/lib/agents";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  agent: AgentMeta;
  disabled: boolean;
  onSend: (content: string) => void;
  onStop?: () => void;
  /** 是否显示新手提问示例 */
  showStarters: boolean;
}

export function ChatInput({
  agent,
  disabled,
  onSend,
  onStop,
  showStarters,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      200,
    )}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        {showStarters && (
          <div className="mb-3 flex flex-wrap gap-2">
            {agent.starterPrompts.map((p) => (
              <button
                key={p}
                type="button"
                className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                onClick={() => onSend(p)}
                disabled={disabled}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm transition focus-within:shadow-focus",
          )}
        >
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`和 ${agent.displayName} 说点什么…  (Enter 发送 · Shift+Enter 换行)`}
            rows={1}
            className="max-h-[200px] min-h-[44px] resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
          />
          {disabled ? (
            <Button
              size="icon"
              variant="secondary"
              onClick={onStop}
              title="停止生成"
              disabled={!onStop}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              title="发送 (Enter)"
              disabled={!value.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          AI 老师可能会犯错。重要的题目记得自己再验证一遍 🙂
        </p>
      </div>
    </div>
  );
}
