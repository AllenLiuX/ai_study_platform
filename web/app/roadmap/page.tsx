"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Flag,
  Loader2,
  LockKeyhole,
  Map,
  RotateCcw,
  Sparkles,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAgentMeta } from "@/lib/agents";
import { agentsApi, chatApi, practiceStudioApi, roadmapsApi } from "@/lib/api";
import type {
  ChatSession,
  GenerateRoadmapRequest,
  LearningRoadmap,
  RoadmapNode,
  RoadmapNodeStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** 根据规划 + 节点拼一段 starter prompt，进入对话后自动发送给老师。 */
function buildNodePrompt(roadmap: LearningRoadmap, node: RoadmapNode): string {
  const lines = [
    `我正在按照我的学习规划「${roadmap.title}」推进，现在想开始学习下面这个节点。`,
    "",
    `【学习节点】${node.title}`,
    node.description ? `节点说明：${node.description}` : "",
    node.phase ? `所处阶段：${node.phase}` : "",
    node.next_action ? `建议的下一步：${node.next_action}` : "",
    node.mastery_evidence?.length
      ? `掌握标准：${node.mastery_evidence.join("；")}`
      : "",
    "",
    `请作为我的老师带我系统学习这个节点：先讲清核心概念和常见误区，再给我可操作的练习或任务来检验掌握。整体对齐我的目标：${roadmap.goal}。`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** 为某个规划节点拼一段「练习工坊」生成描述，让 AI 出针对这一节的可判分练习。 */
function buildNodePracticeDescription(
  roadmap: LearningRoadmap,
  node: RoadmapNode,
): string {
  const lines = [
    `围绕我的学习规划「${roadmap.title}」中的这个节点，为我造一台有针对性、能反复上手练的交互式训练器。`,
    `【节点】${node.title}`,
    node.description ? `节点范围：${node.description}` : "",
    node.phase ? `所处阶段：${node.phase}` : "",
    node.mastery_evidence?.length
      ? `需要达到的掌握标准：${node.mastery_evidence.join("；")}`
      : "",
    `整体学习目标：${roadmap.goal}`,
    "请选择最贴合这个节点核心能力的训练器形态（模拟器/计时训练/跟读/记忆卡/拖拽/决策沙盘等），重在动手操作与即时反馈。",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 1900);
}

const STATUS_META: Record<
  RoadmapNodeStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  done: {
    label: "已掌握",
    className: "border-emerald-300 bg-emerald-50 text-emerald-900",
    icon: CheckCircle2,
  },
  current: {
    label: "正在学",
    className: "border-primary bg-primary/10 text-foreground",
    icon: Target,
  },
  open: {
    label: "可开始",
    className: "border-border bg-card text-foreground",
    icon: Flag,
  },
  locked: {
    label: "未解锁",
    className: "border-border bg-muted/50 text-muted-foreground",
    icon: LockKeyhole,
  },
  review: {
    label: "待复习",
    className: "border-amber-300 bg-amber-50 text-amber-900",
    icon: RotateCcw,
  },
};

export default function RoadmapPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const roadmapsQuery = useQuery({
    queryKey: ["roadmaps"],
    queryFn: roadmapsApi.list,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.list,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [startingNodeId, setStartingNodeId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [practicingNodeId, setPracticingNodeId] = useState<string | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);

  const roadmaps = roadmapsQuery.data ?? [];
  const activeRoadmap =
    roadmaps.find((item) => item.id === activeId) ?? roadmaps[0] ?? null;

  const selectedNode = useMemo(() => {
    if (!activeRoadmap) return null;
    const all = activeRoadmap.lanes.flatMap((lane) => lane.nodes);
    return (
      all.find((node) => node.id === selectedNodeId) ??
      all.find((node) => node.status === "current") ??
      all[0] ??
      null
    );
  }, [activeRoadmap, selectedNodeId]);

  const generateMutation = useMutation({
    mutationFn: (payload: GenerateRoadmapRequest) => roadmapsApi.generate(payload),
    onSuccess: (roadmap) => {
      queryClient.setQueryData<LearningRoadmap[]>(["roadmaps"], (old) => [
        roadmap,
        ...(old ?? []).filter((item) => item.id !== roadmap.id),
      ]);
      setActiveId(roadmap.id);
      setSelectedNodeId(
        roadmap.lanes.flatMap((lane) => lane.nodes).find((n) => n.status === "current")
          ?.id ?? null,
      );
      setShowCreate(false);
    },
  });

  const nodeMutation = useMutation({
    mutationFn: ({
      roadmapId,
      nodeId,
      status,
      mastery,
    }: {
      roadmapId: string;
      nodeId: string;
      status?: RoadmapNodeStatus;
      mastery?: number;
    }) => roadmapsApi.updateNode(roadmapId, nodeId, { status, mastery }),
    onSuccess: (updated) => {
      queryClient.setQueryData<LearningRoadmap[]>(["roadmaps"], (old) =>
        (old ?? []).map((item) => (item.id === updated.id ? updated : item)),
      );
    },
  });

  // 「开始学习」：为该节点开一个对话 (跟随规划绑定的老师)，并携带 starter prompt 进入 chat。
  async function startLearning(node: RoadmapNode) {
    if (!activeRoadmap || startingNodeId) return;
    setStartingNodeId(node.id);
    setStartError(null);
    try {
      const agentType = activeRoadmap.agent_key || "head_teacher";
      const meta = resolveAgentMeta(agentType, agentsQuery.data);
      const session = await chatApi.createSession({
        agent_type: agentType,
        subject_id: meta.subjectId ?? null,
        title: node.title.slice(0, 20),
      });
      // 立即写入 chat-sessions 缓存，避免进入 chat 页时因 stale list 被弹回。
      queryClient.setQueryData<ChatSession[]>(["chat-sessions"], (prev) => {
        const list = prev ?? [];
        return [session, ...list.filter((s) => s.id !== session.id)];
      });
      void queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
      queryClient.setQueryData(["chat-messages", session.id], []);
      // 顺手把节点标记为「正在学」(已掌握的节点不降级)。
      if (node.status !== "done") {
        nodeMutation.mutate({
          roadmapId: activeRoadmap.id,
          nodeId: node.id,
          status: "current",
        });
      }
      const prompt = buildNodePrompt(activeRoadmap, node);
      router.push(`/chat/${session.id}?prompt=${encodeURIComponent(prompt)}`);
    } catch (err) {
      setStartingNodeId(null);
      setStartError(
        err instanceof Error ? err.message : "无法开始学习，请稍后再试",
      );
    }
  }

  // 「生成专属训练器」：用练习工坊为该节点即时生成一台交互式训练器并进入。
  async function practiceNode(node: RoadmapNode) {
    if (!activeRoadmap || practicingNodeId) return;
    setPracticingNodeId(node.id);
    setPracticeError(null);
    try {
      const description = buildNodePracticeDescription(activeRoadmap, node);
      const rec = await practiceStudioApi.generate({ description });
      void queryClient.invalidateQueries({ queryKey: ["practice-studios"] });
      router.push(`/practice-studio/${rec.id}`);
    } catch (err) {
      setPracticingNodeId(null);
      setPracticeError(
        err instanceof Error ? err.message : "生成训练器失败，请稍后再试",
      );
    }
  }

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-7xl space-y-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Map className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">学习规划</h1>
              <Badge variant="secondary">专属路线</Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              围绕你的目标安排学习路径，用阶段成果记录每一步成长。
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            生成新规划
          </Button>
        </header>

        {roadmapsQuery.isLoading ? (
          <LoadingState />
        ) : roadmapsQuery.error ? (
          <ErrorCard message={(roadmapsQuery.error as Error).message} />
        ) : !activeRoadmap ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <>
            <RoadmapSummary
              roadmap={activeRoadmap}
              roadmaps={roadmaps}
              onSelect={(id) => {
                setActiveId(id);
                setSelectedNodeId(null);
              }}
            />

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <RoadmapTree
                roadmap={activeRoadmap}
                selectedNodeId={selectedNode?.id ?? null}
                onSelect={setSelectedNodeId}
              />
              {selectedNode && (
                <NodeInspector
                  node={selectedNode}
                  pending={nodeMutation.isPending}
                  starting={startingNodeId === selectedNode.id}
                  error={startError}
                  practicing={practicingNodeId === selectedNode.id}
                  practiceError={practiceError}
                  onStartLearning={() => startLearning(selectedNode)}
                  onPractice={() => practiceNode(selectedNode)}
                  onStatus={(status, mastery) =>
                    nodeMutation.mutate({
                      roadmapId: activeRoadmap.id,
                      nodeId: selectedNode.id,
                      status,
                      mastery,
                    })
                  }
                />
              )}
            </div>
          </>
        )}
      </main>

      {showCreate && (
        <CreateRoadmapDialog
          agents={agentsQuery.data ?? []}
          loading={generateMutation.isPending}
          error={generateMutation.error}
          onClose={() => {
            if (!generateMutation.isPending) setShowCreate(false);
          }}
          onSubmit={(payload) => generateMutation.mutate(payload)}
        />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在读取学习规划…
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-8 text-sm text-destructive">
        无法读取学习规划：{message}
      </CardContent>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-16 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Map className="h-7 w-7" />
        </span>
        <h2 className="text-lg font-semibold">还没有长期学习规划</h2>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          告诉系统你想学什么、现在会什么、每周能投入多少时间，AI 会生成动态学习线和可验证节点。
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          生成第一份规划
        </Button>
      </CardContent>
    </Card>
  );
}

function RoadmapSummary({
  roadmap,
  roadmaps,
  onSelect,
}: {
  roadmap: LearningRoadmap;
  roadmaps: LearningRoadmap[];
  onSelect: (id: string) => void;
}) {
  const nodes = roadmap.lanes.flatMap((lane) => lane.nodes);
  const completed = nodes.filter((node) => node.status === "done").length;
  const totalHours = nodes.reduce((sum, node) => sum + node.estimated_hours, 0);
  const progress = nodes.length ? Math.round((completed / nodes.length) * 100) : 0;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{roadmap.title}</h2>
              <Badge>{roadmap.lanes.length} 条学习线</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {roadmap.goal}
            </p>
          </div>
          {roadmaps.length > 1 && (
            <select
              aria-label="切换规划"
              value={roadmap.id}
              onChange={(event) => onSelect(event.target.value)}
              className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm"
            >
              {roadmaps.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat icon={Target} label="整体完成" value={`${progress}%`} />
          <SummaryStat icon={Map} label="学习结构" value={`${roadmap.lanes.length} 线 · ${nodes.length} 节点`} />
          <SummaryStat icon={Clock3} label="预计总投入" value={`${totalHours} 小时`} />
          <SummaryStat
            icon={CalendarDays}
            label="学习节奏"
            value={`每周 ${roadmap.weekly_hours} 小时`}
          />
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Target;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function RoadmapTree({
  roadmap,
  selectedNodeId,
  onSelect,
}: {
  roadmap: LearningRoadmap;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      {roadmap.lanes.map((lane) => (
        <Card key={lane.id} className="overflow-hidden">
          <CardHeader className="border-b border-border/60 py-4">
            <CardTitle className="text-base">{lane.title}</CardTitle>
            <p className="text-xs font-normal text-muted-foreground">{lane.purpose}</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-4 [scrollbar-width:thin]">
            <div className="flex min-w-max items-stretch gap-3">
              {lane.nodes.map((node, index) => (
                <div key={node.id} className="flex items-center gap-3">
                  <NodeCard
                    node={node}
                    selected={node.id === selectedNodeId}
                    onClick={() => onSelect(node.id)}
                  />
                  {index < lane.nodes.length - 1 && (
                    <div className="h-px w-5 bg-border" aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NodeCard({
  node,
  selected,
  onClick,
}: {
  node: RoadmapNode;
  selected: boolean;
  onClick: () => void;
}) {
  const meta = STATUS_META[node.status];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-52 rounded-xl border p-3 text-left transition hover:-translate-y-0.5",
        meta.className,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1 font-medium">
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </span>
        <span className="opacity-70">{node.estimated_hours}h</span>
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-semibold">{node.title}</div>
      <div className="mt-1 line-clamp-2 text-xs opacity-75">{node.description}</div>
      {node.mastery > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full bg-current opacity-60"
            style={{ width: `${node.mastery}%` }}
          />
        </div>
      )}
    </button>
  );
}

function NodeInspector({
  node,
  pending,
  starting,
  error,
  practicing,
  practiceError,
  onStartLearning,
  onPractice,
  onStatus,
}: {
  node: RoadmapNode;
  pending: boolean;
  starting: boolean;
  error: string | null;
  practicing: boolean;
  practiceError: string | null;
  onStartLearning: () => void;
  onPractice: () => void;
  onStatus: (status: RoadmapNodeStatus, mastery?: number) => void;
}) {
  const meta = STATUS_META[node.status];
  const isDone = node.status === "done";
  return (
    <Card className="xl:sticky xl:top-24">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{node.title}</CardTitle>
          <Badge variant="outline">{meta.label}</Badge>
        </div>
        <p className="text-xs font-normal text-muted-foreground">
          {node.phase || "自适应阶段"} · 预计 {node.estimated_hours} 小时
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">{node.description}</p>

        {node.prerequisites.length > 0 && (
          <DetailList title="解锁条件" items={node.prerequisites} />
        )}
        <DetailList
          title="掌握证据"
          items={
            node.mastery_evidence.length
              ? node.mastery_evidence
              : ["完成老师设定的阶段测评"]
          }
        />
        {node.next_action && (
          <div className="rounded-xl bg-primary/8 p-3">
            <div className="text-xs font-semibold text-primary">下一步</div>
            <p className="mt-1 text-sm leading-5">{node.next_action}</p>
          </div>
        )}

        <div className="space-y-2">
          <Button
            className="w-full"
            size="lg"
            disabled={starting || pending}
            onClick={onStartLearning}
          >
            {starting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <BookOpen className="mr-1.5 h-4 w-4" />
            )}
            {starting ? "正在进入…" : isDone ? "复习这一节" : "开始学习"}
          </Button>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            variant="secondary"
            disabled={practicing || starting || pending}
            onClick={onPractice}
          >
            {practicing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Dumbbell className="mr-1.5 h-4 w-4" />
            )}
            {practicing ? "正在生成…" : "生成专属训练器"}
          </Button>
          {practiceError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {practiceError}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={pending || starting}
            onClick={() => onStatus("current")}
          >
            设为当前
          </Button>
          <Button
            variant="secondary"
            disabled={pending || starting}
            onClick={() => onStatus("done", 100)}
          >
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            标记掌握
          </Button>
          <Button
            variant="outline"
            disabled={pending || starting}
            onClick={() => onStatus("review")}
          >
            加入复习
          </Button>
          <Button
            variant="outline"
            disabled={pending || starting}
            onClick={() => onStatus("open")}
          >
            重新开放
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5 text-sm">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateRoadmapDialog({
  agents,
  loading,
  error,
  onClose,
  onSubmit,
}: {
  agents: Awaited<ReturnType<typeof agentsApi.list>>;
  loading: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (payload: GenerateRoadmapRequest) => void;
}) {
  const [goal, setGoal] = useState("");
  const [baseline, setBaseline] = useState("");
  const [weeklyHours, setWeeklyHours] = useState(8);
  const [targetDate, setTargetDate] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [preferences, setPreferences] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="生成学习规划"
    >
      <Card className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto">
        <CardHeader>
          <CardTitle>生成动态学习规划</CardTitle>
          <p className="text-sm font-normal text-muted-foreground">
            告诉我们你的目标和当前基础，老师会为你安排合适的学习路径。
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (goal.trim().length < 3) return;
              onSubmit({
                goal: goal.trim(),
                baseline: baseline.trim(),
                weekly_hours: weeklyHours,
                target_date: targetDate || null,
                agent_key: agentKey || null,
                preferences: preferences.trim(),
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="roadmap-goal">想学好的方向和最终目标 *</Label>
              <Textarea
                id="roadmap-goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="例如：一年内从零基础达到日语 N2，并能在日本旅行和工作会议中自然交流"
                rows={3}
                maxLength={1000}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="roadmap-baseline">当前基础</Label>
              <Textarea
                id="roadmap-baseline"
                value={baseline}
                onChange={(event) => setBaseline(event.target.value)}
                placeholder="已经会什么、做过什么项目、考试成绩或最薄弱的部分"
                rows={2}
                maxLength={2000}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="roadmap-hours">每周小时</Label>
                <Input
                  id="roadmap-hours"
                  type="number"
                  min={1}
                  max={80}
                  value={weeklyHours}
                  onChange={(event) =>
                    setWeeklyHours(Math.max(1, Number(event.target.value) || 1))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roadmap-date">目标日期</Label>
                <Input
                  id="roadmap-date"
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roadmap-agent">跟随老师</Label>
                <select
                  id="roadmap-agent"
                  value={agentKey}
                  onChange={(event) => setAgentKey(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">通用规划教练</option>
                  {agents.map((agent) => (
                    <option key={agent.agent_key} value={agent.agent_key}>
                      {agent.emoji} {agent.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="roadmap-preferences">偏好与约束</Label>
              <Input
                id="roadmap-preferences"
                value={preferences}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder="例如：偏项目实战、工作日只能碎片学习、周末集中练习"
                maxLength={1000}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={loading || goal.trim().length < 3}>
                {loading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                {loading ? "正在设计路线…" : "生成规划"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
