# WaveSynAgent

**🌐 在线体验：<https://wavesynagent.metagaruta.com>**

[English](README.en.md) | **中文**

**Web 波表合成器 + AI Agent 系统** —— 在浏览器里演奏、调音，并让 AI 助手帮你设计音色。

核心亮点：内置基于 **ReAct 模式** 的 AI Agent，能理解"温暖的 Pad"、"沉重的 Bass"这类自然语言描述，自主调用合成器工具完成调参、试听和预设保存，同时兼任制作人与音乐教师。

## 功能特性

### 🎹 合成器
- **3 个振荡器**：sine / triangle / sawtooth / square + **真实波表模式**（4 张内置表：Basic Morph / Formant / Digital / Soft，位置 morph 交叉淡化），unison（1-8 声部）、半音/微调、声像
- **2 -op FM**：OSC2→OSC1 音频级频率调制（FM 2→1 旋钮 / Agent 可调）
- **滤波器**：lowpass / highpass / bandpass / notch，cutoff + resonance + **包络量（可听）** + **键盘跟踪**，双极滤波器包络
- **双 ADSR 包络**：AMP 与 Filter 独立包络
- **双 LFO + 调制矩阵**：双极 depth（-1 ~ 1），源 LFO1/LFO2/**ModWheel**，目标含滤波、音量、效果参数与声部级 pitch/pan
- **9 种效果器**：Distortion、BitCrusher、Compressor、EQ3、Chorus、Phaser、Delay、Reverb、StereoWidener，**效果链顺序可自由拖拽重排**
- **16 复音**，虚拟键盘 + 电脑键盘 + **Web MIDI 输入**（延音踏板 CC64 / 调制轮 CC1），示波器 + FFT 频谱实时可视化
- **多轨工作**：最多 8 轨，每轨独立合成引擎 + 序列器 pattern + 混音通道（音量/声像/mute/solo），共享全局 Transport 严格同步；轨道栏快速切换/新建/删除
- **步进序列器**：每轨独立 16/32 步网格、循环播放、播放中热编辑
- **WAV 导出**：全部可听轨的混音（尊重 mute/solo）离线渲染为 16-bit 立体声 WAV
- **Undo/Redo**：全参数历史栈（Ctrl+Z / Ctrl+Shift+Z），用户与 Agent 操作统一记录

### 🤖 AI Agent
- 自然语言调音：描述目标音色，Agent 自动规划并执行多步参数调整
- **25 个工具**：`set_params`（批量调参）、`read_synth_state`、各合成器面板专用工具、`set_mod_route`、`reorder_effect_chain`、`play_notes`、`sequence_pattern`、`sequencer_control`、`export_audio`、`analyze_audio`、`snapshot_patch`、`restore_snapshot`、`undo_last_change`、`save_preset`、**多轨工具**（`create_track` / `select_track` / `set_track_mixer`，`set_params` 等支持 `track_index` 定向）、`propose_plan`、`update_preferences`
- **会听的 Agent**：`analyze_audio` 播放音符并回传响度/削波/明亮度/频段分布，形成 调整→验证→再调整 闭环
- **计划模式**：开启后 Agent 改动前先提交分步计划卡，用户确认才执行
- **口味记忆**：用户表达的稳定偏好（“我喜欢暗的音色”）被记住并跨会话注入上下文
- **会话摘要压缩**：长对话自动把早期消息压缩为确定性摘要（不额外消耗 token）
- 多会话管理、思考过程与操作历史可视化、流式输出、**可中断生成**（Stop 按钮）、回合耗时与 token 用量显示
- 快照工作流：大改前自动 `snapshot_patch`，不满意可 `restore_snapshot` 回滚
- 安全护栏：参数范围双端校验（注册表驱动）、工具调用次数上限、会话看门狗

### 🔌 多 LLM 支持
统一抽象层，一行配置切换：**OpenAI / Anthropic Claude / DeepSeek / 阿里百炼（DashScope）**，token 用量实时可见

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
│   │       ├── engine/        # AudioEngine（Tone.js）、波表、导出、参数注册表
│   │       ├── components/    # 旋钮/键盘/序列器/各面板/Agent 聊天面板
│   │       ├── stores/        # Zustand：synth / agent / preset / sequencer / midi
│   │       └── visualizers/   # 示波器、频谱
│   ├── api-server/        # Fastify + Prisma：用户/预设/项目 CRUD、JWT、WebSocket
│   └── agent-server/      # FastAPI：ReAct Agent 核心、工具集、LLM 抽象层、评测
├── deploy/                # nginx / systemd / 部署脚本（gitignore，本地维护）
└── .github/workflows/     # ci.yml（类型检查+测试门禁）+ deploy.yml（自动部署）
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

## 测试与质量

```bash
pnpm --filter frontend test        # vitest：注册表/撤销栈/序列器/导出编码/MIDI 解析
pnpm --filter agent-server test    # pytest：ReAct 循环场景（Mock LLM）/工具校验
pnpm --filter frontend gen:params --check   # 前后端参数注册表漂移检查
```

CI（`.github/workflows/ci.yml`）在每次 push/PR 时强制：类型检查、全部单测、注册表一致性。

## 部署

生产部署通过 GitHub Actions 自动化：push 到 `main`/`master` 后构建前端静态文件，rsync 到服务器，由 nginx 提供前端（Cloudflare 代理）并反代 `/agent-api/*` 到 FastAPI（systemd 守护）。线上地址 **<https://wavesynagent.metagaruta.com>**。

完整运维手册（服务器初始化、Secrets 配置、排障）见 `deploy/README.md`（本地维护，不纳入 git 跟踪）。

## License

ISC
