#!/usr/bin/env python
"""
基于课标 yaml,用 gpt-4o 生成「平台公共资料」markdown 讲义。

输入:
  seed-data/curriculum/<subject>.yaml

输出:
  seed-data/platform/<subject>/<topic-id>.md  (一个 topic 一份讲义)

用法:
  python scripts/generate_knowledge_notes.py                  # 全部学科 全部 topic
  python scripts/generate_knowledge_notes.py --subject math
  python scripts/generate_knowledge_notes.py --topic math-circle
  python scripts/generate_knowledge_notes.py --model gpt-4o-mini   # 也可以省钱跑

设计原则:
  - 幂等:已存在的 .md 文件默认跳过,加 --force 才覆盖
  - 不抓任何第三方教辅,只依靠 LLM 通识知识 + 课标骨架 yaml
  - markdown 风格固定,便于切片器拆得整齐
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import yaml

# 把 api/ 加入 sys.path 复用后端配置
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

# 必须先 import config 触发 NO_PROXY 注入
from app.core.config import get_settings  # noqa: E402
from app.core.llm import ModelTier, get_client, resolve_model  # noqa: E402

CURRICULUM_DIR = ROOT / "seed-data" / "curriculum"
PLATFORM_DIR = ROOT / "seed-data" / "platform"

SYSTEM_PROMPT_HEAD = """请严格遵循:
1. 不抄任何教材原文或具体教辅内容,所有例子由你自己出
2. 学习者是初中生,语言要平实、有节奏感,避免成人化术语堆砌
3. 输出必须严格遵循下面这个 markdown 结构模板,**不要添加额外的一级标题**
4. 数学公式用 $...$ (行内) 或 $$...$$ (居中);不要用 \\( ... \\)
5. 全文 1500-2500 字,不要拖沓
6. 直接输出 markdown,不要包在 ``` 代码块里

# markdown 结构模板
"""

USER_PROMPT_TEMPLATE = """请基于以下信息撰写讲义:

- 知识点 id: {topic_id}
- 标题: {title}
- 学段: {stage} / {grade_range}
- 学科: {subject}
- 学习目标: {learning_objective}
- 关键词 (供你参考,不必逐字使用): {keywords}

按系统提示中的 markdown 结构模板输出。
"""


async def generate_one(
    *,
    client,
    model: str,
    topic: dict,
    persona: str,
    template: str,
    subject: str,
    stage: str,
    grade_range: str,
) -> str:
    user_prompt = USER_PROMPT_TEMPLATE.format(
        topic_id=topic["id"],
        title=topic["title"],
        stage=stage,
        grade_range=grade_range,
        subject=subject,
        learning_objective=topic.get("learning_objective", ""),
        keywords=", ".join(topic.get("keywords", [])) or "(无)",
    )
    # template 里包含 {title} 这类占位符,LLM 自己理解,不能用 .format
    system_prompt = persona + "\n\n" + SYSTEM_PROMPT_HEAD + template

    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
    )
    return resp.choices[0].message.content or ""


async def process_subject_file(
    *,
    yaml_path: Path,
    model: str,
    only_topic: str | None,
    force: bool,
    concurrency: int = 4,
) -> tuple[int, int, int]:
    """处理单个学科 yaml,返回 (generated, skipped, failed)。"""
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    subject = data["subject_id"]
    stage = data.get("stage", "")
    grade_range = data.get("grade_range", "")
    persona = data["generator_persona"].strip()
    template = data["template"].strip()
    topics = data["topics"]

    out_dir = PLATFORM_DIR / subject
    out_dir.mkdir(parents=True, exist_ok=True)

    client = get_client()
    generated = 0
    skipped = 0
    failed = 0
    sem = asyncio.Semaphore(concurrency)

    async def run(topic: dict) -> None:
        nonlocal generated, skipped, failed
        if only_topic and topic["id"] != only_topic:
            return
        out_path = out_dir / f"{topic['id']}.md"
        if out_path.exists() and not force:
            print(f"  · skip {topic['id']} (已存在,加 --force 覆盖)")
            skipped += 1
            return
        async with sem:
            print(f"  → generating {topic['id']} | {topic['title']}")
            try:
                md = await generate_one(
                    client=client,
                    model=model,
                    topic=topic,
                    persona=persona,
                    template=template,
                    subject=subject,
                    stage=stage,
                    grade_range=grade_range,
                )
            except Exception as exc:
                print(f"  ✗ {topic['id']} 失败: {exc}")
                failed += 1
                return
            out_path.write_text(md.strip() + "\n", encoding="utf-8")
            generated += 1

    await asyncio.gather(*(run(t) for t in topics))
    return generated, skipped, failed


async def main_async(args: argparse.Namespace) -> int:
    settings = get_settings()
    if not settings.openai_api_key:
        print("✗ OPENAI_API_KEY 未配置")
        return 1

    model = args.model or resolve_model(ModelTier.PREMIUM)
    print(f"使用模型: {model}")

    yaml_files = sorted(CURRICULUM_DIR.glob("*.yaml"))
    if args.subject:
        yaml_files = [p for p in yaml_files if p.stem.startswith(args.subject)]
    if not yaml_files:
        print(f"✗ 没找到匹配的 yaml: subject={args.subject}")
        return 1

    total_g = total_s = total_f = 0
    for p in yaml_files:
        print(f"\n=== {p.name} ===")
        g, s, f = await process_subject_file(
            yaml_path=p,
            model=model,
            only_topic=args.topic,
            force=args.force,
            concurrency=args.concurrency,
        )
        print(f"  生成 {g} · 跳过 {s} · 失败 {f}")
        total_g += g
        total_s += s
        total_f += f

    print(f"\n汇总:生成 {total_g} · 跳过 {total_s} · 失败 {total_f}")
    return 0 if total_f == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="基于课标 yaml 生成 AI 讲义 markdown")
    parser.add_argument("--subject", help="只处理某个学科 (math / english / chinese),按 yaml 文件名前缀匹配")
    parser.add_argument("--topic", help="只处理某一个 topic id,例如 math-circle")
    parser.add_argument("--model", help=f"覆盖默认模型,默认 = premium ({os.environ.get('OPENAI_CHAT_MODEL_PREMIUM', 'gpt-4o')})")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的 markdown")
    parser.add_argument("--concurrency", type=int, default=4, help="并发请求数,默认 4")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
