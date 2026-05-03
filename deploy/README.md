# 部署指南

WaveSynAgent 部署到 Ubuntu 22.04 服务器（http://20.243.161.134），通过 GitHub Actions 自动化。

## 架构

```
       浏览器
         │  HTTP :80
         ▼
    ┌─────────┐
    │  nginx  │  default_server
    └────┬────┘
         │
   ┌─────┴──────────────────────┐
   │                            │
   ▼ /                          ▼ /agent-api/* (rewrite -> /)
[静态前端]                  127.0.0.1:3002
~/wavesynagent/frontend     uvicorn / FastAPI
                            (systemd: wavesyn-agent.service)
```

- **前端**: Vite 构建产物，nginx 直接提供静态文件
- **agent-server**: Python venv + FastAPI，用 systemd 守护
- **api-server (Node)**: 暂不部署
- **CI/CD**: GitHub Actions（push 到 `main` 自动触发）

## 一次性服务器初始化

把仓库克隆到本地后，先把仓库 push 到 GitHub。然后在你机器上：

```bash
# 把 deploy/ 目录推到服务器（或先 push 后通过 workflow，但 bootstrap 必须手动跑一次）
scp -i C:\ot\Azure_vm\DailyAiDetectionKey.pem -r deploy animnia@20.243.161.134:/tmp/
ssh -i C:\ot\Azure_vm\DailyAiDetectionKey.pem animnia@20.243.161.134
sudo bash /tmp/deploy/scripts/bootstrap.sh
```

`bootstrap.sh` 会：
1. 安装 nginx、Python 3.11、build-essential、rsync
2. 创建目录 `~/wavesynagent/{frontend,agent-server,repo-deploy}`
3. 部署 nginx site 配置 + WebSocket upgrade map
4. 安装 systemd unit `wavesyn-agent.service`（启用但暂不启动）
5. 写入 `/etc/sudoers.d/wavesyn-deploy`，允许 animnia 免密执行 `systemctl restart wavesyn-agent` / `reload nginx`
6. 放行 ufw 80 端口（如启用）

## 配置 GitHub 仓库 Secrets

在仓库 **Settings → Secrets and variables → Actions** 添加：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `SSH_PRIVATE_KEY` | `DailyAiDetectionKey.pem` 的完整内容（包括 BEGIN/END 行） |
| Secret | `DEEPSEEK_API_KEY` | DeepSeek key |
| Secret（可选） | `OPENAI_API_KEY` | |
| Secret（可选） | `ANTHROPIC_API_KEY` | |
| Secret（可选） | `DASHSCOPE_API_KEY` | |
| Variable（可选） | `DEFAULT_PROVIDER` | 默认 `deepseek` |

> 注意：Secret 内容如果是私钥，**直接粘贴整个文件**，不要 base64。

## 触发部署

```bash
git push origin main
```

或在 Actions 页面手动 `Run workflow`。流程：

1. 在 GitHub runner 上 `pnpm install` 并 `pnpm run build` 出 `frontend/dist`
2. `rsync` 把 `frontend/dist` 和 `packages/agent-server/` 推到服务器 `/tmp/wavesyn-stage/`
3. 把 `deploy/` 目录同步到服务器 `~/wavesynagent/repo-deploy/`（这样下次 deploy.sh 也是最新的）
4. 用 GitHub Secrets 中的 API key 生成 `.env` 并安全 scp
5. 在服务器执行 `deploy.sh`：rsync 到正式目录、`pip install -e .`、`sudo systemctl restart wavesyn-agent`、`sudo systemctl reload nginx`
6. Smoke test: `curl http://server/agent-api/health`

## 服务器目录布局

```
/home/animnia/wavesynagent/
├── frontend/                # Vite dist (nginx root)
├── agent-server/
│   ├── app/                 # 源码
│   ├── pyproject.toml
│   ├── .venv/               # 跨部署保留
│   └── .env                 # 由 workflow 写入，含 API keys
└── repo-deploy/             # 最新的 deploy/ 目录副本
    ├── nginx/
    ├── systemd/
    └── scripts/{bootstrap,deploy}.sh
```

## 常用运维

```bash
# 查看 agent-server 日志
sudo journalctl -u wavesyn-agent -f

# 手动重启
sudo systemctl restart wavesyn-agent

# 重新加载 nginx
sudo nginx -t && sudo systemctl reload nginx

# 查看 nginx 访问/错误日志
sudo tail -f /var/log/nginx/{access,error}.log

# 修改 .env 后立即生效
sudo nano ~/wavesynagent/agent-server/.env
sudo systemctl restart wavesyn-agent
```

## 故障排查

- **WebSocket 连不上**：确认 `/etc/nginx/conf.d/upgrade-map.conf` 存在且 `nginx -t` 通过；确认浏览器没有混合内容警告（HTTP 站点不会有）
- **/agent-api/* 404**：检查 nginx site 是否启用了 `wavesynagent`；`sudo ls /etc/nginx/sites-enabled/` 应该看到 `wavesynagent` 且没有 `default`
- **服务启动失败**：`sudo journalctl -u wavesyn-agent -n 100` 查日志；最常见是 `.env` 缺 API key 或 `.venv` 没装好
- **GitHub Actions 卡在 `ssh-keyscan`**：服务器防火墙需放行 22 端口（Azure NSG）
- **Smoke test 失败但服务运行**：手动 `curl http://localhost:3002/health`（在服务器上）排除 nginx 配置问题
