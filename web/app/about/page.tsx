import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  Compass,
  GraduationCap,
  Headphones,
  Layers,
  Library,
  LineChart,
  type LucideIcon,
  Map,
  MessageSquare,
  Notebook,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "关于我们 · AI 自适应学习平台",
  description:
    "AI 自适应学习平台：为每位学习者配备专属 AI 老师团，围绕个人目标生成学习规划，用自适应练习、听课转写与知识沉淀构成完整学习闭环。面向个人学习者、学校与培训机构提供解决方案。",
};

// 核心能力
const CAPABILITIES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: GraduationCap,
    title: "专属 AI 老师团",
    desc: "内置班主任与各科老师，也可自定义任意方向的老师；每位老师有独立人设与资料库。",
  },
  {
    icon: MessageSquare,
    title: "基于资料的对话",
    desc: "上传教材、讲义、错题，AI 基于你的材料作答并给出可溯源引用，显著减少凭空编造。",
  },
  {
    icon: Map,
    title: "个性化学习规划",
    desc: "把「学好一个方向」拆成动态学习线与阶段节点，学习线数量随目标与基础自动调整。",
  },
  {
    icon: Target,
    title: "自适应练习",
    desc: "按薄弱点智能出题、即时讲评，练习结果回写掌握度，持续查漏补缺。",
  },
  {
    icon: Headphones,
    title: "听课实时转写",
    desc: "课堂或讲座边听边转写，结束后一键蒸馏成结构化复习笔记。",
  },
  {
    icon: Notebook,
    title: "知识沉淀与召回",
    desc: "对话、练习、听课都能沉淀成知识笔记，自动参与后续检索召回，越用越懂你。",
  },
  {
    icon: Users,
    title: "群组 / 班级协作",
    desc: "创建或加入群组，共享资料库与笔记，适合班级、学习小组与团队统一管理。",
  },
  {
    icon: LineChart,
    title: "数据驱动的成长",
    desc: "自动抽取知识点掌握度，生成今日任务与进度视图，让学习进展看得见。",
  },
];

// 学习闭环
const LOOP: { step: string; icon: LucideIcon; title: string; desc: string }[] = [
  {
    step: "01",
    icon: Compass,
    title: "设定目标",
    desc: "告诉我们你的目标与当前基础，上传相关资料，建立个性化起点。",
  },
  {
    step: "02",
    icon: BookOpen,
    title: "学 · 练 · 听",
    desc: "跟 AI 老师对话讲解、做自适应练习、把课堂听成笔记。",
  },
  {
    step: "03",
    icon: Layers,
    title: "自动沉淀",
    desc: "关键知识点沉淀为笔记，掌握度实时更新，形成可复用的知识库。",
  },
  {
    step: "04",
    icon: Map,
    title: "持续规划",
    desc: "学习规划依据最新进展动态调整，形成越学越准的正循环。",
  },
];

// 差异化 / 信任
const DIFFERENTIATORS: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: ShieldCheck,
    title: "答案基于你的资料",
    desc: "检索增强让回答扎根于你上传的材料，引用可回溯，而非泛泛而谈。",
  },
  {
    icon: Sparkles,
    title: "真正的自适应",
    desc: "从每次对话与练习中提取掌握度，动态调整推荐任务与学习路线。",
  },
  {
    icon: Layers,
    title: "完整学习闭环",
    desc: "输入、学习、沉淀、规划四环相扣，把零散学习变成持续积累。",
  },
  {
    icon: LineChart,
    title: "多档模型分级",
    desc: "按任务难度选择合适的模型，在效果与成本之间取得平衡。",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-app-gradient">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-2">
          <Link href="/about" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold tracking-tight">
                AI 自适应学习平台
              </span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Adaptive AI Study Platform
              </span>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <a
              href="#capabilities"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              核心能力
            </a>
            <a
              href="#how"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              学习闭环
            </a>
            <a
              href="#audience"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              解决方案
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              登录
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              免费开始
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container flex flex-col items-center py-20 text-center sm:py-28">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          为每位学习者配备专属 AI 老师团
        </span>
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          不只是问答，而是陪你把目标
          <br className="hidden sm:block" />
          真正学成的 AI 学习伙伴
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          围绕你的目标生成学习规划，用基于你自己资料的对话、自适应练习、听课转写与知识沉淀，
          构成一个越学越懂你的完整学习闭环。
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90"
          >
            免费开始使用
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#audience"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition hover:border-primary/40 hover:text-primary"
          >
            <Building2 className="h-4 w-4" />
            学校 / 机构合作
          </a>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          个人免费起步 · 无需信用卡
        </p>
      </section>

      {/* 核心能力 */}
      <section id="capabilities" className="container py-16">
        <SectionHeading
          eyebrow="Capabilities"
          title="一个平台，覆盖学习的每一环"
          desc="从提问、练习到规划与协作，把碎片化的学习动作整合进同一个系统。"
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="rounded-2xl border border-border bg-card p-5 shadow-card"
              >
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-base font-semibold tracking-tight">
                  {c.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {c.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 学习闭环 */}
      <section id="how" className="container py-16">
        <SectionHeading
          eyebrow="How it works"
          title="四步形成学习正循环"
          desc="每一次学习都会沉淀为下一次更个性化的建议，越用越懂你。"
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {LOOP.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.step}
                className="relative rounded-2xl border border-border bg-card p-6 shadow-card"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-2xl font-semibold text-border">
                    {s.step}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 差异化 */}
      <section className="container py-16">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-card sm:p-12">
          <SectionHeading
            eyebrow="Why us"
            title="为什么选择我们"
            desc="不是又一个聊天机器人，而是为「学有所成」而设计的学习系统。"
            align="left"
          />
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {DIFFERENTIATORS.map((d) => {
              const Icon = d.icon;
              return (
                <div key={d.title} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">
                      {d.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {d.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 面向对象 / 解决方案 */}
      <section id="audience" className="container py-16">
        <SectionHeading
          eyebrow="Solutions"
          title="适合个人，也适合团队"
          desc="从个人自主学习到学校班级统一管理，同一套能力灵活适配。"
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* B2C */}
          <div className="flex flex-col rounded-3xl border border-border bg-card p-8 shadow-card">
            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <GraduationCap className="h-5 w-5" />
            </span>
            <h3 className="text-xl font-semibold tracking-tight">个人学习者</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              学生、备考人群、自学新技能与转岗人群。
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "全科 / 全方向 AI 老师，随时讲解答疑",
                "个性化学习规划，把大目标拆成每日一步",
                "自适应练习与听课转写，学练结合",
                "知识笔记自动沉淀，构建私人知识库",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              免费注册
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* B2B */}
          <div className="flex flex-col rounded-3xl border border-border bg-card p-8 shadow-card">
            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-foreground">
              <Building2 className="h-5 w-5" />
            </span>
            <h3 className="text-xl font-semibold tracking-tight">
              学校 · 培训机构 · 团队
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              以班级 / 团队为单位，统一管理资料与学习协作。
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "群组共享资料库与笔记，班级知识统一沉淀",
                "可定制专属老师（Agent），贴合课程与教研",
                "私有资料检索增强，答案扎根机构自有内容",
                "使用情况后台看板，掌握整体学习进展",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <a
              href="mailto:contact@aico-music.com?subject=AI%20学习平台%20-%20商务合作咨询"
              className="mt-8 inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition hover:border-primary/40 hover:text-primary"
            >
              <MessageSquare className="h-4 w-4" />
              预约演示 / 商务咨询
            </a>
          </div>
        </div>
      </section>

      {/* 结尾 CTA */}
      <section className="container py-20">
        <div className="flex flex-col items-center rounded-3xl border border-primary/20 bg-primary/5 px-6 py-14 text-center">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            让每一次学习，都朝目标更近一步
          </h2>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            现在就开始，为自己或你的团队搭建专属的 AI 学习系统。
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90"
            >
              免费开始使用
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition hover:border-primary/40 hover:text-primary"
            >
              已有账号，登录
            </Link>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="border-t border-border/60">
        <div className="container flex flex-col items-center justify-between gap-3 py-8 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-foreground text-background">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span>AI 自适应学习平台 · Adaptive AI Study Platform</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="transition hover:text-foreground">
              登录
            </Link>
            <Link href="/signup" className="transition hover:text-foreground">
              注册
            </Link>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  desc,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  align?: "center" | "left";
}) {
  return (
    <div
      className={
        align === "center"
          ? "mx-auto max-w-2xl text-center"
          : "max-w-2xl text-left"
      }
    >
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {desc && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {desc}
        </p>
      )}
    </div>
  );
}
