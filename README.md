# WaveSynAgent

**🌐 在线体验：<https://wavesynagent.metagaruta.com>**

[English](README.en.md) | **中文**

**Web 波表合成器 + AI Agent 系统** —— 在浏览器里演奏、调音，并让 AI 助手帮你设计音色。

核心亮点：内置基于 **ReAct 模式** 的 AI Agent，能理解"温暖的 Pad"、"沉重的 Bass"这类自然语言描述，自主调用合成器工具完成调参、试听和预设保存，同时兼任制作人与音乐教师。

## 功能特性

### 🎹 合成器
- **3 个振荡器**：sine / triangle / sawtooth / square，支持 unison（1-8 声部）、半音/微调试音、声像
- **滤波器**：lowpass / highpass / bandpass / notch，cutoff + resonance + 包络量 + 键盘跟踪
- **双 ADSR 包络**：AMP 与 Filter 独立包络
- **双 LFO + 调制矩阵**：双极 depth（-1 ~ 1），可路由到滤波、音量、效果等目标
- **9 种效果器**：Distortion、BitCrusher、Compressor、EQ3、Chorus、Phaser、Delay、Reverb、StereoWidener，**效果链顺序可自由拖拽重排**
- **16 复音**，虚拟键盘演奏，示波器 + FFT 频谱实时可视化

### 🤖 AI Agent
- 自然语言调音：描述目标音色，Agent 自动规划并执行多步参数调整
- 合成器工具集：`read_synth_state`、`set_oscillator`、`set_filter`、`set_envelope`、`set_lfo`、`set_effects`、`set_mod_route`、`reorder_effect_chain`、`play_notes`、`save_preset`
- 边调边讲：解释调整思路与音乐理论，可调完立即 `play_notes` 试听（和弦/琶音两种模式）
- 多会话管理、思考过程与操作历史可视化、流式输出
- 安全护栏：参数范围校验、工具调用次数上限、用户操作优先

### 🔌 多 LLM 支持
统一抽象层，一行配置切换：**OpenAI / Anthropic Claude / DeepSeek / 阿里百炼（DashScope）**

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + TailwindCSS 4 + Zustand |
| 音频引擎 | Tone.js + Web Audio API |
| AI Agent | Python 3.11+ + FastAPI（WebSocket 流式推送） |
| 后端 API | Node.js + Fastify + Prisma + PostgreSQL（JWT 认证） |
| 部署 | GitHub Actions + nginx + systemd |

## 项目结构

```
WaveSynAgent/
├── packages/
│   ├── frontend/          # React 前端（合成器工作站 + Agent 面板）
│   │   └── src/
│   │       ├── engine/        # AudioEngine（Tone.js 封装）、类型、预设
│   │       ├── components/    # 旋钮/键盘/各面板/Agent 聊天面板
│   │       ├── stores/        # Zustand：synth / agent / preset
│   │       └── visualizers/   # 示波器、频谱
│   ├── api-server/        # Fastify + Prisma：用户/预设/项目 CRUD、JWT、WebSocket
│   └── agent-server/      # FastAPI：ReAct Agent 核心、工具集、LLM 抽象层
├── deploy/                # nginx / systemd / 部署脚本（gitignore，本地维护）
└── .github/workflows/     # push 到 main/master 自动部署
```

## 快速开始

**环境要求**：Node.js 20+、pnpm 10、Python 3.11+（建议用 uv）、PostgreSQL（仅 api-server 需要）

```bash
# 1. 安装依赖
pnpm install
cd packages/agent-server && uv sync   # 或 pip install -e .

# 2. 配置环境变量
cp .env.example .env
# 至少填入一个 LLM 的 API Key（如 DEEPSEEK_API_KEY）

# 3. 启动开发服务
pnpm dev              # 并行启动全部
# 或按需单独启动：
pnpm dev:frontend     # 前端      → http://localhost:5173
pnpm dev:api          # API 服务  → http://localhost:3001
pnpm dev:agent        # Agent 服务 → http://localhost:3002
```

> 最小体验只需 **frontend + agent-server**：打开页面演奏合成器，右下角打开 Agent 面板即可对话调音。api-server（账号/云端预设）为可选；首次运行前先 `pnpm --filter api-server db:generate` 生成 Prisma 客户端。

## 部署

生产部署通过 GitHub Actions 自动化：push 到 `main`/`master` 后构建前端静态文件，rsync 到服务器，由 nginx 提供前端（Cloudflare 代理）并反代 `/agent-api/*` 到 FastAPI（systemd 守护）。线上地址 **<https://wavesynagent.metagaruta.com>**。

完整运维手册（服务器初始化、Secrets 配置、排障）见 `deploy/README.md`（本地维护，不纳入 git 跟踪）。

## License

ISC
