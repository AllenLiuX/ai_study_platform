# 生产部署速查 (自有服务器)

把后端跑在你自己的 Linux 服务器,前端继续放 Vercel。本指南 ~20 分钟跑通。

## 你需要

- 一台公网可访问的 Linux 服务器 (Ubuntu/Debian 推荐,任何云厂商 VPS 都行,1C2G 起步)
- 一个域名 + DNS 控制权,把 `api.yourdomain.com` 解析到服务器 IP (前端用 Vercel 域名)
- 已配好的 Supabase 项目 + 已应用 0001/0002/0003 三个 migration + seed
- OpenAI API key

## 一、服务器上准备

```bash
# 1. 装基础工具 (一次性)
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip nginx certbot python3-certbot-nginx git

# 2. 创建部署用户 + 拉代码
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /srv/student_coach
sudo chown -R deploy:deploy /srv/student_coach
sudo -iu deploy
git clone <your-repo-url> /srv/student_coach
cd /srv/student_coach

# 3. 配 .env (复制模板填真实值)
cp .env.example .env
nano .env
```

`.env` 里至少要改的几个值（生产关键）:

```bash
# 必填真实值
OPENAI_API_KEY=sk-proj-xxx
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 让 Vercel 前端能连得到 (production + preview 都允许)
BACKEND_CORS_ORIGINS=https://ai-study-platform-xi.vercel.app
BACKEND_CORS_ORIGIN_REGEX=^https://ai-study-platform[a-z0-9-]*\.vercel\.app$

# 监听端口 (反向代理转发到这里)
BACKEND_PORT=8000
BACKEND_WORKERS=2
LOG_LEVEL=INFO
```

## 二、跑一次确认能起

```bash
# 还是 deploy 用户
cd /srv/student_coach
./deploy/start_prod.sh
# 另一个终端:curl 本地确认
curl http://127.0.0.1:8000/health/config
# Ctrl+C 退出前台
```

看到 `openai_configured: true` / `supabase_configured: true` 就 OK。

## 三、配 systemd 让它自启 + 自动重启

```bash
# 切回 sudo 用户
exit

# 拷贝 service 文件,编辑里面路径
sudo cp /srv/student_coach/deploy/student-coach-api.service.example /etc/systemd/system/student-coach-api.service
sudo nano /etc/systemd/system/student-coach-api.service
# 主要确认:WorkingDirectory / EnvironmentFile / User 跟你的实际路径一致

sudo systemctl daemon-reload
sudo systemctl enable --now student-coach-api
sudo systemctl status student-coach-api      # 看是否 active (running)
sudo journalctl -u student-coach-api -f       # 跟踪日志
```

## 四、配 nginx 反向代理 + HTTPS

```bash
sudo cp /srv/student_coach/deploy/nginx.conf.example /etc/nginx/sites-available/student-coach-api
sudo nano /etc/nginx/sites-available/student-coach-api
# 把 api.yourdomain.com 改成你真实的域名

sudo ln -s /etc/nginx/sites-available/student-coach-api /etc/nginx/sites-enabled/
sudo nginx -t                                   # 配置语法检查
sudo systemctl reload nginx

# Let's Encrypt 自动签 HTTPS 证书
sudo certbot --nginx -d api.yourdomain.com
sudo systemctl reload nginx
```

测试:浏览器 / curl 访问 `https://api.yourdomain.com/health/config`,看到 JSON 就成。

> **SSE 关键点**:`nginx.conf.example` 里的 `proxy_buffering off`、`X-Accel-Buffering no`、`proxy_read_timeout 300s` 都是为了让 chat 流式响应能逐字传到前端,不要随便改。

## 五、Vercel 前端配上后端地址

进 Vercel Dashboard → 你的项目 → Settings → Environment Variables,**添加三个变量** (Production + Preview 都勾上):

| 变量名 | 值 |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...`(anon key,不是 service role) |

加完 **务必触发一次重新部署** (Redeploy),Next.js 的 `NEXT_PUBLIC_*` 变量是 build time 注入的,不重新 build 旧站点拿不到。

## 六、自检清单

部署完跑一遍这些,任何一项失败都立刻能定位:

```bash
# 1. 后端公网可达
curl https://api.yourdomain.com/health/config
# 应返回:{"openai_configured": true, "supabase_configured": true, "models": {...}, ...}

# 2. CORS 已正确放行 Vercel
curl -I -H "Origin: https://ai-study-platform-xi.vercel.app" https://api.yourdomain.com/health/config
# 响应头里应该有:access-control-allow-origin: https://ai-study-platform-xi.vercel.app

# 3. 浏览器测前端
# 打开 https://ai-study-platform-xi.vercel.app/dashboard
# DevTools → Network → 看 /api/student/dashboard 请求,状态 200 即成
```

## 升级 / 重新部署

```bash
sudo -iu deploy
cd /srv/student_coach
git pull
# 如果 requirements.txt 有变,start_prod.sh 会自动 pip install
sudo systemctl restart student-coach-api
sudo journalctl -u student-coach-api -n 50
```

## 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 浏览器 `Failed to fetch` | Vercel 上 `NEXT_PUBLIC_API_BASE_URL` 没设或没重新 build | Vercel Settings → Env Vars → Redeploy |
| 浏览器报 CORS 错 (有 `Access-Control-Allow-Origin` 字样) | 后端 `BACKEND_CORS_ORIGINS` 没包含 vercel 的 URL | 改 .env → `sudo systemctl restart student-coach-api` |
| Chat 不流式 (要等回答完整个一次性出现) | nginx 没关 buffering | 检查 `proxy_buffering off` 在 location 块里;重载 nginx |
| 502 Bad Gateway | uvicorn 没起 / 监听端口与 nginx upstream 不一致 | `systemctl status student-coach-api` + 看 journalctl |
| 资料上传 413 | nginx 默认 1M body 限制 | nginx 配里 `client_max_body_size 30M;` 已经设了,检查实际生效 |
