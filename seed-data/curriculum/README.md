# 课标骨架 (Curriculum Skeleton)

这个目录里存放各学科的 **课程标准要点** —— 是 AI 生成知识点讲义的 source-of-truth。

## 数据来源

- **2022 年义务教育课程方案与课程标准** — 教育部公开发布,无版权限制
  - 数学:[义务教育数学课程标准 (2022 版)](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)
  - 英语:[义务教育英语课程标准 (2022 版)](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)
  - 语文:[义务教育语文课程标准 (2022 版)](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)
- 教材章节对应 (人教版 / 北师大版 / 苏教版) 仅作 "学段映射" 参考,不直接引用教材文字

## 文件结构

```
curriculum/
├── math_middle.yaml       # 初中数学核心知识点
├── english_middle.yaml    # 初中英语核心语法 + 阅读
└── chinese_middle.yaml    # 初中语文核心能力
```

每个 yaml 里的 `topics[]` 是一个数组,每个 topic 会被 `scripts/generate_knowledge_notes.py`
作为一份独立的「平台公共资料」生成 markdown 讲义,再由 `scripts/seed_platform_materials.py`
入库到 Supabase。

## 风险声明

- yaml 里只写"知识点名称 + 学段 + prompt 要点",**不包含任何具体教材内容**
- 生成出来的 markdown 是 LLM (gpt-4o) 基于课标和通识知识生成的衍生内容,经过人工 review 后入库
- 不直接复制 / scrape 任何教辅、出版社、付费平台的内容
