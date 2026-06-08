# 学生学习驾驶舱 - FastAPI 后端

## 本地启动

```bash
cd api
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 确保根目录 .env 已配置好 Supabase keys
uvicorn app.main:app --reload --port 8000
```

访问 http://localhost:8000/docs 查看 OpenAPI 文档。

## 目录结构

```text
api/
  app/
    main.py              FastAPI 入口
    core/
      config.py          读取 .env 的统一配置
      auth.py            Supabase JWT 验证
      llm.py             OpenAI 客户端封装,按场景选择模型
    routes/
      health.py
      students.py
      chat.py
    services/
      agent_service.py   Agent 推理入口
      chat_service.py    会话与消息持久化
    agents/
      registry.py        四个 Agent 的配置注册
      prompts/           每个 Agent 的 system prompt (md 文件)
    db/
      supabase_client.py 后端 service role 客户端
      repos.py           CRUD 封装
    schemas/             Pydantic 模型
```
