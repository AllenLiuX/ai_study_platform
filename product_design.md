下面这版我会按**“能在 4–8 周内做出可用 MVP”**来设计，避免一开始就做复杂的学校 SaaS、大规模题库、完整教务系统。重点是：学生登录后围绕“班主任 Agent + 各科老师 Agent + 学习资料库 + 学习进度画像”形成闭环。

合规上要提前注意：面向国内未成年人时，需要特别处理个人信息最小化、学习记录保护、家长/学校授权、内容安全、防沉迷等问题。《生成式人工智能服务管理暂行办法》要求服务提供者保护用户输入信息和使用记录，不得收集非必要个人信息，并采取措施防止未成年人过度依赖或沉迷生成式 AI 服务；《未成年人网络保护条例》已于 2024 年 1 月 1 日起施行，也强调未成年人网络保护和个人信息保护。([中国互联网违法和不良信息举报中心][1])

# 国内初高中 AI 学习平台 MVP 产品设计文档

## 1. 产品定位

本产品是一个面向国内初高中学生的 AI 个性化学习平台。它不是单纯的聊天机器人，也不是传统题库网站，而是一个“学生学习驾驶舱 + 多学科 AI 老师 + 学习资料库 + 个性化学习进度系统”。

学生登录后，可以与“班主任 Agent”和“各科老师 Agent”对话，完成学习规划、知识点讲解、作业辅导、错题复盘、资料问答和阶段性提升建议。平台内置初高中主科和副科的结构化学习资料，同时允许学生上传课内讲义、作业、试卷、笔记等材料，形成个人学习知识库。

MVP 的核心目标不是替代老师，而是帮助学生在课后获得更稳定、更个性化、更可追踪的学习支持。

---

## 2. MVP 核心目标

### 2.1 用户目标

学生需要解决的问题：

1. 不知道自己每科当前学到哪里、薄弱点在哪里。
2. 遇到作业或知识点问题时，缺少即时、耐心、可追问的讲解。
3. 学习资料分散，课本、讲义、试卷、笔记之间无法统一检索。
4. 学习计划缺少连续性，每次问 AI 都像从零开始。
5. 家长或老师难以看到学生具体在哪些知识点上卡住。

### 2.2 产品目标

MVP 阶段只解决四个核心闭环：

1. **学生画像闭环**：记录学生年级、科目、学习进度、薄弱点、近期问题。
2. **资料问答闭环**：学生上传资料后，可以围绕资料进行问答和总结。
3. **多 Agent 学习闭环**：班主任 Agent 做规划，各科老师 Agent 做学科辅导。
4. **学习任务闭环**：AI 根据学生情况生成学习任务，学生完成后更新进度。

---

## 3. 目标用户

### 3.1 MVP 首批用户

建议先聚焦一个窄场景：

**初中学生，数学 + 英语 + 语文三个主科。**

原因：

1. 初中知识体系相对标准化。
2. 学生自主学习需求明显。
3. 家长付费意愿较强。
4. 数学和英语最适合 AI 辅导 MVP 验证。
5. 语文可用于作文、阅读理解、文言文讲解等高频场景。

### 3.2 后续扩展用户

第二阶段再扩展到：

1. 高中学生。
2. 物理、化学、生物、历史、地理、政治。
3. 班级/学校级账号。
4. 家长端和老师端。

---

## 4. MVP 产品边界

### 4.1 MVP 做什么

MVP 必须包含：

1. 学生账号登录。
2. 学生选择年级、教材版本、科目。
3. 首页展示学习进度和推荐任务。
4. 班主任 Agent 对话。
5. 各科老师 Agent 对话。
6. 上传学习资料。
7. 对上传资料进行解析、切片、检索和问答。
8. AI 自动记录学生提问、薄弱知识点、学习任务。
9. 简单的学习报告页面。
10. 管理端上传公共学习资料。

### 4.2 MVP 暂时不做什么

MVP 不做：

1. 完整在线考试系统。
2. 大规模自动批改主观题。
3. 学校教务系统集成。
4. 复杂班级管理。
5. 家校沟通系统。
6. 直播课。
7. 复杂付费体系。
8. 自研大模型。
9. 完整题库采购和版权内容运营。
10. 高并发多租户架构。

---

## 5. 核心用户流程

## 5.1 学生首次登录流程

学生进入平台后：

1. 使用手机号、邮箱或学校邀请码登录。
2. 填写基础信息：

   * 年级：初一、初二、初三、高一、高二、高三。
   * 当前教材版本。
   * 重点科目。
   * 近期目标，例如月考、期中、期末、中考。
3. 选择目前最想提升的科目。
4. 系统生成初始学习画像。
5. 进入学生首页。

首次登录后，班主任 Agent 主动发起对话：

> 你好，我是你的 AI 班主任。我会帮你记录各科进度、发现薄弱点、安排学习任务。你可以先告诉我：你最近最想提升哪一科？最近一次考试哪里失分最多？

---

## 5.2 日常学习流程

学生每天进入平台后：

1. 查看今日学习任务。
2. 选择一个任务，例如“七年级数学：一元一次方程复习”。
3. 进入对应科目老师 Agent。
4. AI 老师先讲知识点，再给例题，再让学生尝试。
5. 学生提问或上传作业截图/文档。
6. AI 老师根据资料和学生历史记录回答。
7. 对话结束后，系统自动更新：

   * 学习过的知识点。
   * 学生是否掌握。
   * 仍然存在的问题。
   * 推荐下一步任务。

---

## 5.3 上传资料学习流程

学生上传资料后：

1. 选择资料所属科目。
2. 选择资料类型：

   * 课本章节
   * 老师讲义
   * 作业
   * 试卷
   * 错题
   * 笔记
3. 系统解析文件内容。
4. AI 自动生成：

   * 资料摘要
   * 涉及知识点
   * 可能考点
   * 推荐学习任务
5. 学生可以直接问：

   * “这份讲义讲了什么？”
   * “老师今天讲的重点是什么？”
   * “帮我用初二能听懂的话解释第二题。”
   * “这张卷子我主要错在哪些知识点？”

---

## 6. 核心页面设计

## 6.1 登录页

功能：

1. 学生登录。
2. 学校邀请码入口。
3. 测试账号快速体验。
4. 家长/老师入口预留，但 MVP 可以暂不开放。

页面元素：

* 产品名称。
* 一句话定位：你的 AI 班主任和各科老师。
* 登录按钮。
* Demo 入口。

---

## 6.2 学生首页：学习驾驶舱

首页是 MVP 最重要的页面。

### 页面模块

#### A. 顶部学生信息

展示：

* 学生姓名。
* 年级。
* 当前目标。
* 今日学习状态。

示例：

> 初二 · 目标：期末数学提升到 90 分 · 今日已学习 25 分钟

#### B. 今日推荐任务

展示 3 个任务：

1. 必做任务。
2. 薄弱点任务。
3. 复习任务。

示例：

* 数学：复习一次函数图像与性质，预计 20 分钟。
* 英语：完成过去完成时错题复盘，预计 15 分钟。
* 语文：阅读理解答题结构训练，预计 20 分钟。

#### C. 各科学习进度卡片

每个科目一张卡：

* 当前章节。
* 掌握度。
* 最近薄弱点。
* 进入老师 Agent 按钮。

示例：

数学
当前：一次函数
掌握度：65%
薄弱点：函数图像、实际应用题
按钮：找数学老师

#### D. 班主任 Agent 入口

固定展示：

> 找 AI 班主任：帮我安排学习计划 / 分析最近问题 / 制定考试冲刺计划

#### E. 最近学习记录

展示最近 5 条：

* 问过的问题。
* 学过的知识点。
* 上传过的资料。
* 完成的任务。

---

## 6.3 Agent 对话页

这是核心学习界面。

### 页面结构

左侧：

* Agent 列表：

  * 班主任 Agent
  * 数学老师 Agent
  * 英语老师 Agent
  * 语文老师 Agent
  * 物理老师 Agent，后续扩展
  * 化学老师 Agent，后续扩展

中间：

* 对话窗口。
* 支持文本输入。
* 支持上传文档。
* 支持上传图片，MVP 可先只支持 PDF、Word、TXT，图片 OCR 后续做。

右侧：

* 当前学生画像。
* 当前科目进度。
* 相关资料引用。
* 推荐下一步任务。

### 对话页关键能力

1. 每个 Agent 有自己的角色和知识边界。
2. 回答时结合：

   * 学生年级。
   * 当前科目。
   * 当前教材版本。
   * 学生历史问题。
   * 上传资料。
   * 平台公共资料。
3. 回答后可以生成学习记录。
4. 对话过程中可以推荐任务。

---

## 6.4 学习资料库页面

资料库分成两类：

### A. 平台公共资料

由平台管理员上传，包括：

* 各年级各科知识点大纲。
* 教材章节资料。
* 高频考点。
* 学习方法。
* 例题讲解。
* 中考/高考考点梳理。

### B. 学生个人资料

学生上传：

* 老师讲义。
* 试卷。
* 作业。
* 笔记。
* 错题。
* 课本截图。

### 页面功能

1. 按科目筛选。
2. 按年级筛选。
3. 按资料类型筛选。
4. 查看资料摘要。
5. 进入资料问答。
6. 删除个人资料。
7. 重新解析资料。

---

## 6.5 学习报告页面

MVP 阶段做简单报告即可。

### 报告内容

1. 本周学习时长。
2. 本周提问次数。
3. 各科学习次数。
4. 高频薄弱知识点。
5. 已完成任务。
6. AI 推荐下一步。

示例：

> 本周你在数学上提问最多，主要集中在“一次函数”和“方程应用题”。建议下周先完成 3 次函数图像训练，再做 2 组应用题专项练习。

---

## 6.6 管理端页面

MVP 需要一个简单管理端，方便你自己维护内容。

### 管理端功能

1. 上传公共学习资料。
2. 设置资料科目、年级、教材版本。
3. 查看学生列表。
4. 查看学生学习记录。
5. 查看 Agent 对话日志。
6. 手动调整知识点标签。
7. 查看系统错误日志。

---

## 7. Agent 设计

## 7.1 Agent 总体设计

MVP 不建议一开始做复杂的多 Agent 自主协作系统。建议采用“统一 Agent Runtime + 多角色 Prompt + 工具调用”的方式。

也就是说：

* 后端只有一套 Agent 执行框架。
* 不同 Agent 通过不同 system prompt、可访问工具、记忆范围来区分。
* 班主任 Agent 负责规划和跨科总结。
* 各科老师 Agent 负责具体学科辅导。
* 所有 Agent 共用学生画像和学习记录。

---

## 7.2 班主任 Agent

### 职责

1. 了解学生整体学习状态。
2. 生成每日/每周学习计划。
3. 汇总各科薄弱点。
4. 帮学生安排考试复习。
5. 引导学生找到合适的科目老师。
6. 记录学习目标。
7. 给家长/老师生成简短报告，后续扩展。

### 典型问题

* “我这周应该怎么复习？”
* “我数学和英语都不好，先补哪个？”
* “下周月考，我每天怎么安排？”
* “我最近学习效率很低怎么办？”
* “帮我总结一下我最近的问题。”

### 输出风格

班主任 Agent 应该更像学习教练：

* 不直接替学生完成所有作业。
* 优先拆解任务。
* 给出清晰计划。
* 控制学习节奏。
* 鼓励学生主动思考。

---

## 7.3 数学老师 Agent

### 职责

1. 解释数学概念。
2. 分步骤讲题。
3. 发现学生卡点。
4. 生成相似练习题。
5. 记录薄弱知识点。
6. 引导学生自己完成推理。

### 典型问题

* “一次函数为什么是直线？”
* “这道方程应用题怎么列式？”
* “我不会因式分解。”
* “帮我讲一下这张试卷第 5 题。”

### 回答要求

数学老师 Agent 不应该直接只给答案，而应该：

1. 先判断知识点。
2. 再用学生年级能理解的话解释。
3. 给出关键公式。
4. 分步骤推导。
5. 最后给一道类似题检查掌握情况。

---

## 7.4 英语老师 Agent

### 职责

1. 讲解语法。
2. 分析阅读理解。
3. 修改作文。
4. 讲单词和短语。
5. 生成背诵和练习计划。

### 典型问题

* “现在完成时和一般过去时有什么区别？”
* “这篇阅读为什么选 B？”
* “帮我改一下这篇英语作文。”
* “这个句子怎么翻译？”

---

## 7.5 语文老师 Agent

### 职责

1. 阅读理解讲解。
2. 文言文翻译。
3. 作文构思。
4. 古诗文赏析。
5. 答题模板训练。

### 典型问题

* “这篇阅读的中心思想是什么？”
* “文言文这句话怎么翻译？”
* “作文怎么开头更好？”
* “赏析句子应该怎么答？”

---

## 8. 学习流设计

## 8.1 标准学习流

一个标准学习流包括：

1. 选择学习目标。
2. AI 讲解知识点。
3. AI 给例题。
4. 学生尝试回答。
5. AI 反馈。
6. AI 标记掌握情况。
7. AI 推荐下一步。

### 示例

学生选择任务：

> 数学：一次函数图像与性质

数学老师 Agent：

1. 先解释一次函数的基本形式。
2. 展示图像特点。
3. 给一个简单例题。
4. 让学生回答斜率和截距。
5. 根据学生回答判断掌握程度。
6. 如果错误，重新讲解。
7. 如果正确，推荐进阶应用题。

---

## 8.2 作业辅导流

学生上传作业后：

1. AI 识别题目。
2. 判断科目和知识点。
3. 询问学生：“你卡在哪一步？”
4. 如果学生不知道，从第一步讲起。
5. 不直接给最终答案，先引导学生推理。
6. 学生尝试后，AI 再反馈。
7. 记录错因。

### 错因分类

MVP 可以先用简单分类：

1. 概念不清。
2. 公式不会。
3. 审题错误。
4. 计算错误。
5. 方法选择错误。
6. 表达不规范。

---

## 8.3 资料问答流

学生上传讲义后：

1. 系统解析。
2. 自动摘要。
3. 自动提取知识点。
4. 学生围绕资料提问。
5. AI 回答时引用资料片段。
6. AI 推荐相关学习任务。

### 示例问题

* “这份讲义的重点是什么？”
* “老师上课讲的一次函数和我之前学的方程有什么关系？”
* “帮我整理成考试复习笔记。”
* “从这份讲义里出 5 道练习题。”

---

## 9. 数据模型设计

建议使用 Supabase，也就是 PostgreSQL + Auth + Storage + pgvector。这样 MVP 简单、长期可维护，也方便未来迁移。

## 9.1 users 表

记录用户基础信息。

字段：

* id
* email
* phone
* role：student / teacher / admin / parent
* created_at
* updated_at

---

## 9.2 student_profiles 表

记录学生画像。

字段：

* id
* user_id
* name
* grade
* school
* textbook_version
* target_exam
* learning_goal
* created_at
* updated_at

---

## 9.3 subjects 表

记录科目。

字段：

* id
* name
* stage：junior_high / senior_high
* description

示例：

* 数学
* 英语
* 语文
* 物理
* 化学
* 生物
* 历史
* 地理
* 政治

---

## 9.4 knowledge_points 表

记录知识点体系。

字段：

* id
* subject_id
* grade
* chapter
* title
* parent_id
* difficulty_level
* description

示例：

数学：

* 函数

  * 一次函数
  * 二次函数
* 方程

  * 一元一次方程
  * 二元一次方程组

---

## 9.5 student_progress 表

记录学生在每个知识点上的掌握情况。

字段：

* id
* student_id
* subject_id
* knowledge_point_id
* mastery_score：0–100
* confidence：low / medium / high
* last_studied_at
* source：chat / task / upload / quiz
* notes

---

## 9.6 learning_materials 表

记录资料元数据。

字段：

* id
* owner_type：platform / student
* owner_id
* title
* subject_id
* grade
* material_type：textbook / handout / homework / exam / note / wrong_question
* file_url
* parsed_text
* summary
* created_at
* updated_at

---

## 9.7 material_chunks 表

记录资料切片和向量。

字段：

* id
* material_id
* chunk_index
* content
* embedding
* metadata
* created_at

说明：

embedding 字段使用 pgvector。

---

## 9.8 chat_sessions 表

记录对话会话。

字段：

* id
* student_id
* agent_type：head_teacher / math_teacher / english_teacher / chinese_teacher
* subject_id
* title
* created_at
* updated_at

---

## 9.9 chat_messages 表

记录对话消息。

字段：

* id
* session_id
* role：user / assistant / system / tool
* content
* metadata
* created_at

---

## 9.10 learning_tasks 表

记录 AI 生成的学习任务。

字段：

* id
* student_id
* subject_id
* knowledge_point_id
* title
* description
* status：pending / in_progress / completed / skipped
* priority：low / medium / high
* estimated_minutes
* due_date
* created_by：agent / admin / student
* created_at
* updated_at

---

## 9.11 learning_events 表

记录学习行为流水。

字段：

* id
* student_id
* event_type：chat / upload / task_complete / quiz / progress_update
* subject_id
* knowledge_point_id
* metadata
* created_at

---

## 10. 系统架构设计

## 10.1 总体架构

推荐 MVP 架构：

前端：

* Next.js
* Vercel 部署
* Tailwind CSS
* shadcn/ui
* Supabase Auth

后端：

* FastAPI 或 Node.js/NestJS
* 部署在远程服务器
* 提供 Agent API、文件解析 API、学习记录 API

数据库：

* Supabase PostgreSQL
* Supabase Auth
* Supabase Storage
* pgvector

AI 服务：

* LLM API
* Embedding API
* RAG 检索模块
* Agent Orchestrator

文件处理：

* PDF 解析
* Word 解析
* TXT/Markdown 解析
* 图片 OCR 后续扩展

---

## 10.2 架构图

```text
+-----------------------------+
|        Student Web App       |
|      Next.js on Vercel       |
+--------------+--------------+
               |
               | HTTPS
               v
+-----------------------------+
|        Backend API Server    |
|     FastAPI / Node.js        |
|  Deployed on Remote Server   |
+--------------+--------------+
               |
      +--------+---------+
      |                  |
      v                  v
+-------------+    +------------------+
| Supabase    |    | Agent Runtime    |
| Auth        |    | - Head Teacher   |
| Postgres    |    | - Subject Agents |
| Storage     |    | - Tool Calling   |
| pgvector    |    | - Memory Update  |
+-------------+    +------------------+
      |                  |
      |                  v
      |          +------------------+
      |          | RAG Retrieval    |
      |          | - Public Docs    |
      |          | - Student Docs   |
      |          | - Progress Data  |
      |          +------------------+
      |                  |
      |                  v
      |          +------------------+
      |          | LLM Provider     |
      |          | Chat + Embedding |
      |          +------------------+
      |
      v
+-----------------------------+
|     Learning Data Layer      |
| - Student Profile            |
| - Knowledge Points           |
| - Progress                   |
| - Tasks                      |
| - Chat Logs                  |
| - Material Chunks            |
+-----------------------------+
```

---

## 10.3 后端模块

### A. Auth 模块

职责：

* 登录态校验。
* 获取当前用户。
* 区分 student/admin。

推荐直接用 Supabase Auth。

---

### B. Student Profile 模块

接口：

* GET /api/student/profile
* POST /api/student/profile
* PATCH /api/student/profile
* GET /api/student/dashboard

功能：

* 获取学生基本信息。
* 获取学习进度。
* 获取首页推荐任务。

---

### C. Material 模块

接口：

* POST /api/materials/upload
* GET /api/materials
* GET /api/materials/:id
* POST /api/materials/:id/parse
* DELETE /api/materials/:id

功能：

* 上传资料。
* 存储文件。
* 解析文本。
* 生成摘要。
* 切片。
* 生成 embedding。
* 存入 pgvector。

---

### D. Chat / Agent 模块

接口：

* POST /api/chat/sessions
* GET /api/chat/sessions
* GET /api/chat/sessions/:id/messages
* POST /api/chat/sessions/:id/messages

功能：

* 创建对话。
* 发送消息。
* 调用对应 Agent。
* 检索相关资料。
* 生成回答。
* 更新学习记录。

---

### E. Progress 模块

接口：

* GET /api/progress
* PATCH /api/progress
* GET /api/progress/subject/:subjectId

功能：

* 查看各科掌握情况。
* 更新知识点掌握度。
* 给首页提供进度数据。

---

### F. Task 模块

接口：

* GET /api/tasks
* POST /api/tasks
* PATCH /api/tasks/:id
* POST /api/tasks/:id/complete

功能：

* 获取今日任务。
* 创建任务。
* 完成任务。
* 完成后更新学习记录。

---

## 11. RAG 检索设计

## 11.1 检索来源

每次学生向 Agent 提问时，系统可以检索四类上下文：

1. 平台公共资料。
2. 学生个人上传资料。
3. 学生学习进度。
4. 最近对话历史。

---

## 11.2 检索策略

MVP 可以使用简单策略：

1. 根据当前 Agent 判断科目。
2. 根据学生年级过滤资料。
3. 根据 query 做向量检索。
4. 返回 top 5 chunks。
5. 拼接学生画像和最近学习记录。
6. 交给 LLM 生成回答。

### 示例 Prompt 输入结构

```text
你是初二数学老师 Agent。

学生信息：
- 年级：初二
- 教材版本：人教版
- 当前目标：期末数学提升到 90 分

当前学习进度：
- 一次函数：掌握度 65%
- 二元一次方程组：掌握度 80%
- 几何证明：掌握度 45%

相关资料：
[资料片段 1]
[资料片段 2]
[资料片段 3]

学生问题：
为什么一次函数的图像是一条直线？

回答要求：
1. 用初二学生能理解的话解释。
2. 不要直接堆公式。
3. 给一个简单例子。
4. 最后问学生一个检查理解的小问题。
```

---

## 12. Agent Memory 设计

## 12.1 短期记忆

来自当前对话 session。

用途：

* 理解上下文。
* 连续追问。
* 避免重复解释。

存储：

* chat_messages。

---

## 12.2 长期记忆

来自学生画像、学习进度、历史薄弱点。

用途：

* 个性化回答。
* 学习计划。
* 推荐任务。
* 报告生成。

存储：

* student_profiles
* student_progress
* learning_events
* learning_tasks

---

## 12.3 记忆更新机制

每次对话结束后，后端调用一个轻量的“学习记录提取器”。

输入：

* 当前对话内容。
* 当前科目。
* 当前学生画像。

输出：

```json
{
  "subject": "math",
  "knowledge_points": ["一次函数", "函数图像"],
  "mastery_change": -5,
  "weakness": "不能理解斜率和图像倾斜程度的关系",
  "suggested_task": "完成一次函数图像专项练习",
  "confidence": "medium"
}
```

然后写入：

* student_progress
* learning_events
* learning_tasks

---

## 13. Prompt 设计

## 13.1 班主任 Agent System Prompt

```text
你是一个面向中国初高中学生的 AI 班主任。你的目标是帮助学生建立清晰、可执行、不过度焦虑的学习计划。

你需要：
1. 了解学生当前年级、目标、各科进度和薄弱点。
2. 根据学生实际情况安排每日或每周学习任务。
3. 当学生提出具体学科问题时，引导他进入对应学科老师 Agent。
4. 不夸大学习效果，不制造焦虑。
5. 不替学生作弊，不直接完成需要学生独立完成的作业。
6. 优先给出可执行的小步骤。
7. 每次建议尽量控制在 3 个以内。
8. 对未成年人保持积极、耐心、安全的表达方式。

回答格式：
- 先简短回应学生问题。
- 再给出清晰建议。
- 最后给出一个下一步行动。
```

---

## 13.2 各科老师 Agent 通用 Prompt

```text
你是一个面向中国初高中学生的 AI 学科老师。你需要根据学生年级、教材版本、当前进度和上传资料进行个性化讲解。

你需要：
1. 用学生当前年级能理解的语言解释。
2. 优先引导学生理解，而不是直接给答案。
3. 对作业题，先问学生卡在哪一步；如果学生不知道，再分步骤讲。
4. 对知识点，先解释概念，再举例，再检查理解。
5. 发现学生薄弱点时，用简短结构记录。
6. 不编造教材内容；如果资料不足，要说明。
7. 不鼓励学生直接复制答案。
8. 不输出不适合未成年人的内容。

回答格式：
- 知识点判断
- 分步骤讲解
- 例子或类比
- 检查理解的小问题
- 下一步建议
```

---

## 14. 前端页面组件拆分

建议 Cursor 开发时按以下组件拆分。

### 14.1 页面路由

```text
/app
  /login
  /onboarding
  /dashboard
  /chat/[sessionId]
  /materials
  /materials/[id]
  /progress
  /tasks
  /admin
```

---

### 14.2 核心组件

```text
/components
  StudentHeader.tsx
  DashboardTaskCard.tsx
  SubjectProgressCard.tsx
  AgentSidebar.tsx
  ChatWindow.tsx
  ChatInput.tsx
  MaterialUploader.tsx
  MaterialList.tsx
  ProgressHeatmap.tsx
  LearningReportCard.tsx
```

---

### 14.3 前端状态

建议使用：

* React Query / TanStack Query：服务端数据请求。
* Zustand：少量全局状态，例如当前学生、当前 Agent。
* Supabase Client：登录和文件上传。

---

## 15. MVP 开发优先级

## Phase 0：基础工程

目标：搭好项目骨架。

任务：

1. Next.js 前端初始化。
2. Supabase 项目初始化。
3. 后端 API 初始化。
4. 用户登录。
5. 数据库表创建。
6. Vercel 部署。
7. 后端服务器部署。

---

## Phase 1：学生首页 + 基础 Agent 对话

目标：学生可以登录并和 Agent 聊天。

任务：

1. Onboarding 页面。
2. Dashboard 页面。
3. Agent 列表。
4. Chat 页面。
5. Chat session 存储。
6. 接入 LLM。
7. 班主任 Agent Prompt。
8. 数学/英语/语文 Agent Prompt。

验收标准：

* 学生能登录。
* 学生能选择年级和科目。
* 学生能和不同 Agent 对话。
* 对话历史能保存。

---

## Phase 2：资料上传 + RAG

目标：学生可以上传资料并围绕资料问答。

任务：

1. 文件上传到 Supabase Storage。
2. PDF/Word/TXT 解析。
3. 文本切片。
4. embedding 生成。
5. pgvector 检索。
6. 对话时自动召回相关资料。
7. 回答中展示引用资料名称。

验收标准：

* 上传一份讲义后，学生可以问讲义内容。
* AI 回答能基于资料，而不是纯模型记忆。
* 资料能按科目和年级管理。

---

## Phase 3：学习进度与任务

目标：形成学习闭环。

任务：

1. 知识点表初始化。
2. 对话后自动提取知识点。
3. 更新 student_progress。
4. 自动生成 learning_tasks。
5. Dashboard 展示今日任务。
6. 学生完成任务后更新状态。

验收标准：

* 学生问过的问题能沉淀成薄弱点。
* 首页能看到推荐任务。
* 完成任务后进度会变化。

---

## Phase 4：学习报告

目标：让用户看到阶段性价值。

任务：

1. 汇总本周学习记录。
2. 生成各科薄弱点。
3. 生成 AI 学习建议。
4. 展示学习报告页。

验收标准：

* 学生可以看到本周学了什么。
* 系统可以指出主要薄弱知识点。
* 系统可以推荐下周学习重点。

---

## 16. 技术选型建议

## 16.1 前端

推荐：

* Next.js
* TypeScript
* Tailwind CSS
* shadcn/ui
* TanStack Query
* Zustand
* Supabase JS SDK

原因：

* 开发速度快。
* Vercel 部署简单。
* UI 组件成熟。
* 适合 Cursor 协作开发。

---

## 16.2 后端

推荐优先选择 FastAPI。

原因：

* Python 生态适合 AI/RAG。
* 文件解析和 embedding 处理方便。
* API 简洁。
* 后续接 LangChain/LlamaIndex/自定义 Agent 都方便。

可选：

* Node.js/NestJS，如果你更想前后端都用 TypeScript。

---

## 16.3 数据库

推荐 Supabase：

* PostgreSQL 存结构化数据。
* Auth 做登录。
* Storage 存文件。
* pgvector 做向量检索。
* 后续可以平滑扩展。

---

## 16.4 AI 编排

MVP 不建议一开始引入过重框架。

推荐：

* 自己写 Agent Orchestrator。
* 每个 Agent 一个 prompt 配置。
* 工具函数包括：

  * retrieve_materials
  * get_student_profile
  * get_student_progress
  * update_learning_progress
  * create_learning_task

后续再考虑 LangGraph。

---

## 17. API 设计草案

## 17.1 创建对话

```http
POST /api/chat/sessions
```

请求：

```json
{
  "agent_type": "math_teacher",
  "subject_id": "math"
}
```

返回：

```json
{
  "session_id": "xxx",
  "title": "数学老师对话"
}
```

---

## 17.2 发送消息

```http
POST /api/chat/sessions/:id/messages
```

请求：

```json
{
  "content": "一次函数为什么是一条直线？"
}
```

返回：

```json
{
  "answer": "我们可以先从一次函数的形式 y = kx + b 理解...",
  "citations": [
    {
      "material_id": "xxx",
      "title": "初二数学一次函数讲义",
      "chunk_id": "xxx"
    }
  ],
  "learning_update": {
    "knowledge_points": ["一次函数", "函数图像"],
    "mastery_change": 5
  },
  "suggested_tasks": [
    {
      "title": "一次函数图像基础练习",
      "estimated_minutes": 15
    }
  ]
}
```

---

## 17.3 上传资料

```http
POST /api/materials/upload
```

请求：

```json
{
  "file": "binary",
  "subject_id": "math",
  "grade": "初二",
  "material_type": "handout"
}
```

返回：

```json
{
  "material_id": "xxx",
  "status": "processing"
}
```

---

## 17.4 获取首页数据

```http
GET /api/student/dashboard
```

返回：

```json
{
  "profile": {
    "name": "小明",
    "grade": "初二",
    "target_exam": "期末考试"
  },
  "today_tasks": [],
  "subject_progress": [],
  "recent_events": []
}
```

---

## 18. 最小知识点体系

MVP 不需要一次性覆盖完整教材。建议先手动维护一个简化知识点树。

### 初中数学 MVP

1. 数与式
2. 方程与不等式
3. 函数
4. 几何图形
5. 统计与概率

### 初中英语 MVP

1. 词汇
2. 语法
3. 阅读理解
4. 完形填空
5. 写作
6. 听力，后续扩展

### 初中语文 MVP

1. 现代文阅读
2. 文言文
3. 古诗词
4. 作文
5. 基础知识
6. 名著阅读

---

## 19. 首页推荐任务算法

MVP 可以使用规则 + LLM，不需要训练模型。

### 推荐逻辑

优先级从高到低：

1. 最近 7 天频繁提问的知识点。
2. 掌握度低于 60 的知识点。
3. 最近上传资料中出现的重点知识点。
4. 临近考试目标相关知识点。
5. 长时间未复习但曾经学过的知识点。

### 任务生成 Prompt

```text
根据以下学生信息生成 3 个今日学习任务。

学生：
- 年级：初二
- 目标：期末数学提升到 90 分

薄弱点：
- 一次函数图像
- 方程应用题

最近学习记录：
- 昨天学习了一次函数概念
- 前天上传了一张数学讲义

要求：
1. 每个任务 15-25 分钟。
2. 任务要具体。
3. 不要超过 3 个。
4. 每个任务包含标题、描述、预计时间、对应知识点。
```

---

## 20. MVP 成功指标

### 产品指标

1. 学生每周登录次数。
2. 每周有效对话次数。
3. 每个学生上传资料数量。
4. 每周完成任务数量。
5. 学生是否愿意连续使用 2 周以上。

### 学习指标

1. 每个学生沉淀的知识点数量。
2. 每个学生识别出的薄弱点数量。
3. 任务完成率。
4. 同一知识点重复提问次数是否下降。
5. 学生对回答是否有帮助的反馈。

### 技术指标

1. 对话响应时间 < 8 秒。
2. 文件解析成功率 > 90%。
3. RAG 召回内容相关率 > 70%。
4. Agent 回答满意率 > 80%。
5. 系统错误率 < 1%。

---

## 21. 安全与合规设计

面向未成年人产品，MVP 阶段必须加入基础安全设计。

### 21.1 数据最小化

只收集必要信息：

* 年级。
* 科目。
* 学习目标。
* 学习记录。

不默认收集：

* 身份证号。
* 精确家庭地址。
* 不必要的家庭信息。
* 敏感健康信息。

---

### 21.2 内容安全

Agent 需要避免：

1. 不适合未成年人的内容。
2. 鼓励作弊。
3. 直接代写作业。
4. 过度焦虑表达。
5. 负面心理暗示。
6. 不可靠升学承诺。

---

### 21.3 作业辅导边界

平台应该强调：

* 可以讲解思路。
* 可以帮助理解。
* 可以检查答案。
* 不鼓励直接复制 AI 答案。
* 对作文可以给建议和修改，但不应变成完全代写。

---

### 21.4 家长/学校授权

如果进入学校场景，需要增加：

1. 学校管理员授权。
2. 家长知情同意。
3. 学生数据导出和删除机制。
4. 数据访问权限控制。
5. 学习报告的可解释性。

---

## 22. 推荐项目目录

### 前端

```text
ai-learning-platform-web/
  app/
    login/
    onboarding/
    dashboard/
    chat/[sessionId]/
    materials/
    progress/
    tasks/
    admin/
  components/
  lib/
    supabase.ts
    api.ts
  stores/
  types/
```

### 后端

```text
ai-learning-platform-api/
  app/
    main.py
    routes/
      auth.py
      students.py
      chat.py
      materials.py
      progress.py
      tasks.py
    services/
      agent_service.py
      rag_service.py
      material_service.py
      progress_service.py
      task_service.py
    agents/
      prompts/
        head_teacher.md
        math_teacher.md
        english_teacher.md
        chinese_teacher.md
      agent_runtime.py
    db/
      supabase_client.py
      models.py
    utils/
      file_parser.py
      text_splitter.py
```

---

## 23. Cursor 开发顺序建议

建议不要一上来让 Cursor 生成所有东西。应该按模块逐步推进。

### Step 1：生成数据库 schema

先让 Cursor 生成 Supabase SQL migration。

重点表：

* users
* student_profiles
* subjects
* knowledge_points
* student_progress
* learning_materials
* material_chunks
* chat_sessions
* chat_messages
* learning_tasks
* learning_events

---

### Step 2：生成前端基础页面

先做：

1. 登录页。
2. onboarding 页。
3. dashboard 页。
4. chat 页。

暂时用 mock data。

---

### Step 3：接 Supabase Auth 和数据库

把 mock data 替换成真实数据。

---

### Step 4：接后端 Chat API

先实现最简单的 Agent 对话，不做 RAG。

---

### Step 5：接资料上传和 RAG

再实现文件上传、解析、切片、embedding、检索。

---

### Step 6：接学习进度更新

最后实现对话后的学习记录提取和任务生成。

---

## 24. 第一版 MVP 最小可交付范围

第一版真正上线只需要这些功能：

1. 学生登录。
2. 学生填写年级和目标。
3. 首页展示三个科目卡片。
4. 学生可以和班主任、数学、英语、语文 Agent 对话。
5. 学生可以上传 PDF/Word/TXT。
6. Agent 可以基于上传资料回答。
7. 对话后自动记录知识点和薄弱点。
8. 首页推荐 3 个学习任务。
9. 学生可以完成任务。
10. 学习报告页展示本周总结。

如果这些能跑通，就已经是一个完整 MVP。

---

## 25. 产品一句话总结

这个 MVP 的核心不是“让 AI 什么都能教”，而是建立一个长期记录学生学习状态的 AI 学习系统：班主任 Agent 负责规划，各科老师 Agent 负责讲解，资料库负责提供可信上下文，学习进度系统负责沉淀学生画像，最终让每一次提问都能变成下一次更个性化的学习建议。

我建议第一版产品名可以先叫 **AI Study Coach / AI 班主任**，核心卖点不要说“替代老师”，而是说：**“让每个学生都有一个能记住学习进度的课后 AI 学习助手。”**

[1]: https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm?utm_source=chatgpt.com "生成式人工智能服务管理暂行办法"
