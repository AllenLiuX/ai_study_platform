"use client";

import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { agentsApi, materialsApi } from "@/lib/api";
import type {
  CreateUserAgentRequest,
  Material,
  ModelTierId,
  UpdateUserAgentRequest,
  UserAgent,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const TIERS: { value: ModelTierId; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "便宜快,日常问答" },
  { value: "medium", label: "Medium", hint: "默认 · 平衡" },
  { value: "high", label: "High", hint: "强逻辑 · 系统设计" },
  { value: "extra_high", label: "Extra-high", hint: "推理模型 · 长链思考" },
  { value: "max", label: "Max", hint: "最强 · 代价最大" },
];

const SUGGESTED_EMOJIS = [
  "🎓",
  "💡",
  "🧠",
  "🚀",
  "📐",
  "📚",
  "✍️",
  "📖",
  "🧭",
  "🧪",
  "🛠️",
  "💼",
  "🏆",
];

export interface AgentFormProps {
  /** 编辑模式时传入现有 agent;创建模式传 null */
  initial: UserAgent | null;
  onSubmit: (
    payload: CreateUserAgentRequest | UpdateUserAgentRequest,
    mode: "create" | "update",
  ) => Promise<void>;
  /** 提交按钮的 loading 状态由父组件控制 */
  submitting: boolean;
  submitError: string | null;
}

/** 把任意输入转成合法的 agent_key slug (a-z0-9_-)。
 *  中文 / 非 ASCII 字符会全部被过滤,此时返回空 — 调用方需要自行兜底
 *  (常见做法:走后端 LLM 生成的 spec.agent_key,或用 u-<timestamp> fallback)。
 */
function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_\-\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-]+|[_\-]+$/g, "")
    .slice(0, 64);
}

/** 当 display_name 是纯中文 / normalizeKey 返回空时,生成一个 u-<时间戳后 6 位> 的占位 key。 */
function fallbackKey(): string {
  const suffix = String(Date.now() % 1_000_000).padStart(6, "0");
  return `u_${suffix}`;
}

export function AgentForm({
  initial,
  onSubmit,
  submitting,
  submitError,
}: AgentFormProps) {
  const isEdit = initial != null;
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [agentKey, setAgentKey] = useState(initial?.agent_key ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🎓");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [startersText, setStartersText] = useState(
    (initial?.starter_prompts ?? []).join("\n"),
  );
  const [domainsText, setDomainsText] = useState(
    (initial?.domains ?? []).join(", "),
  );
  const [tier, setTier] = useState<ModelTierId>(initial?.default_model_tier ?? "medium");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(
    new Set(initial?.default_material_ids ?? []),
  );
  const [keyAutoFilled, setKeyAutoFilled] = useState(!isEdit);
  const [generating, setGenerating] = useState(false);
  const [generateDesc, setGenerateDesc] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 拉资料列表用于"默认资料"勾选
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMaterialsLoading(true);
    materialsApi
      .list()
      .then((data) => {
        if (!cancelled) setMaterials(data ?? []);
      })
      .catch(() => {
        // 静默 — 资料不影响主表单
      })
      .finally(() => {
        if (!cancelled) setMaterialsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedMaterials = useMemo(() => {
    const groups: { label: string; items: Material[] }[] = [];
    const mine = materials.filter((m) => m.owner_type === "student");
    const platform = materials.filter((m) => m.owner_type === "platform");
    if (mine.length > 0) groups.push({ label: "我上传的", items: mine });
    if (platform.length > 0) groups.push({ label: "平台公共", items: platform });
    return groups;
  }, [materials]);

  const canSubmit =
    !submitting &&
    displayName.trim().length > 0 &&
    (isEdit || agentKey.trim().length >= 2) &&
    systemPrompt.trim().length >= 20;

  function toggleMaterial(id: string) {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generateSpec() {
    if (!generateDesc.trim()) {
      setGenerateError("请填一段描述,例如:面试顶级量化公司 ML Engineer,想专攻系统设计");
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const domains = domainsText
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const spec = await agentsApi.generateSpec(generateDesc.trim(), domains);
      setDisplayName(spec.display_name);
      setEmoji(spec.emoji || "🎓");
      setTagline(spec.tagline);
      setRole(spec.role);
      setSystemPrompt(spec.system_prompt);
      setStartersText(spec.starter_prompts.join("\n"));
      setDomainsText(spec.domains.join(", "));
      setTier(spec.suggested_model_tier);
      if (!isEdit && keyAutoFilled) {
        // Phase 5: 优先用 LLM 给的英文 slug,server 端已 sanitize 过;
        // 退而求其次用 display_name 转化,最后兜底 u_<timestamp>
        const llmKey = normalizeKey(spec.agent_key || "");
        const nameKey = normalizeKey(spec.display_name);
        setAgentKey(llmKey || nameKey || fallbackKey());
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "生成失败,请重试");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const starterPrompts = startersText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    const domains = domainsText
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (isEdit) {
      const update: UpdateUserAgentRequest = {
        display_name: displayName.trim(),
        emoji: emoji || "🎓",
        tagline: tagline.trim() || null,
        role: role.trim() || null,
        system_prompt: systemPrompt.trim(),
        starter_prompts: starterPrompts,
        default_material_ids: Array.from(selectedMaterialIds),
        domains,
        default_model_tier: tier,
      };
      await onSubmit(update, "update");
    } else {
      const create: CreateUserAgentRequest = {
        agent_key: agentKey.trim(),
        display_name: displayName.trim(),
        emoji: emoji || "🎓",
        tagline: tagline.trim() || null,
        role: role.trim() || null,
        system_prompt: systemPrompt.trim(),
        starter_prompts: starterPrompts,
        default_material_ids: Array.from(selectedMaterialIds),
        domains,
        default_model_tier: tier,
      };
      await onSubmit(create, "create");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* AI 帮我生成 */}
      {!isEdit && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <Wand2 className="h-4 w-4" />
            AI 帮我从描述生成老师
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            用一段话描述你想学什么 / 准备什么场景,AI 会帮你填好下面的字段(可再手动微调)。
          </p>
          <Textarea
            rows={3}
            value={generateDesc}
            onChange={(e) => setGenerateDesc(e.target.value)}
            placeholder="例如:我要去面试一家顶级量化公司的 AI Lab Senior ML Engineer,想专攻算法系统设计、事件驱动量化系统、Agent 框架等"
          />
          {generateError && (
            <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {generateError}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={generateSpec}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  正在生成…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  生成配置
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="display_name">老师名称</Label>
          <Input
            id="display_name"
            value={displayName}
            onChange={(e) => {
              const v = e.target.value;
              setDisplayName(v);
              if (!isEdit && keyAutoFilled) {
                // 用户手填 display_name:能 normalize 出 slug 就用;否则保留已有 key
                // (避免一边打字一边把已有 key 抹掉)
                const next = normalizeKey(v);
                if (next) setAgentKey(next);
                else if (!agentKey) setAgentKey(fallbackKey());
              }
            }}
            placeholder="例如:量化系统设计老师"
            maxLength={64}
          />
        </div>
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="agent_key">唯一标识 (URL 用)</Label>
          <Input
            id="agent_key"
            value={agentKey}
            onChange={(e) => {
              setAgentKey(normalizeKey(e.target.value));
              setKeyAutoFilled(false);
            }}
            placeholder="quant_system_design"
            disabled={isEdit}
            maxLength={64}
            className="font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            {isEdit ? "标识创建后无法修改" : "只能小写字母/数字/下划线/连字符"}
          </p>
        </div>
        <div className="space-y-2">
          <Label>Emoji</Label>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={cn(
                  "h-9 w-9 rounded-lg border text-lg transition",
                  emoji === e
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40",
                )}
              >
                {e}
              </button>
            ))}
            <Input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              className="w-16 text-center"
              maxLength={4}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">角色定位 (一句话)</Label>
          <Input
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="例如:系统设计与面试辅导"
            maxLength={80}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tagline">简介 tagline</Label>
          <Input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="例如:陪你拆解架构题、覆盖事件驱动 / Agent 框架 / 期权交易系统"
            maxLength={200}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="system_prompt">System Prompt (老师的人格 / 教学风格)</Label>
        <Textarea
          id="system_prompt"
          rows={12}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="例如:你是一位资深 ML Engineer 面试官,擅长系统设计与算法。每次对话先拆解学生的问题..."
          className="font-mono text-[13px] leading-relaxed"
          maxLength={8000}
        />
        <p className="text-[11px] text-muted-foreground">
          ≥ 20 字符。AI 老师的「性格 / 教学方式 / 输出格式」都在这里。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="starters">开场引导问题 (每行一条,最多 6 条)</Label>
          <Textarea
            id="starters"
            rows={5}
            value={startersText}
            onChange={(e) => setStartersText(e.target.value)}
            placeholder={"帮我列一份事件驱动量化系统的核心模块\n讲下 LRU vs LFU 的取舍\n模拟一道期权交易系统设计面试题"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="domains">关注领域 tags (逗号分隔,最多 10 个)</Label>
          <Input
            id="domains"
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            placeholder="算法系统设计, Agent 框架, 期权交易"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>默认引用的资料 (进入对话后默认勾上,可在对话内调整)</Label>
        {materialsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            加载资料中…
          </div>
        ) : groupedMaterials.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            还没有资料 — 可去「资料库」 tab 上传后再来绑定。
          </p>
        ) : (
          <div className="max-h-60 space-y-3 overflow-y-auto rounded-xl border border-border p-3">
            {groupedMaterials.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMaterialIds.has(m.id)}
                      onChange={() => toggleMaterial(m.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{m.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {m.subject_id ? `${m.subject_id} · ` : ""}
                        {m.material_type}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>默认模型档位</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TIERS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTier(t.value)}
              className={cn(
                "rounded-xl border p-3 text-left text-xs transition",
                tier === t.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40",
              )}
            >
              <div className="text-sm font-medium">{t.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {t.hint}
              </div>
            </button>
          ))}
        </div>
      </div>

      {submitError && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button type="submit" size="lg" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isEdit ? "保存中…" : "创建中…"}
            </>
          ) : isEdit ? (
            "保存修改"
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              创建老师
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

