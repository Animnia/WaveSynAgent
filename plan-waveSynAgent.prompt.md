## Plan: WaveSynAgent — Web 波表合成器 + AI Agent 系统

**TL;DR**: 构建一个 Web 端波表合成器，核心创新是内置 AI Agent 系统（ReAct 模式 + 合成器专用工具集），能自主调音、制作音乐、教学协作。混合架构：React 前端 + Node.js API + Python AI Agent + PostgreSQL。

---

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + TailwindCSS + Zustand |
| 音频引擎 | Tone.js + Web Audio API + AudioWorklet |
| 可视化 | Canvas 2D / WebGL |
| 后端 API | Node.js + Fastify + Prisma ORM |
| AI Agent | Python + FastAPI |
| LLM | OpenAI / Claude / DeepSeek / 阿里百炼（统一抽象层） |
| 数据库 | PostgreSQL |
| 实时通信 | WebSocket (Socket.IO) + Yjs |
| i18n | react-i18next（中/英） |
| 部署 | Docker Compose → 自有服务器 |

---

### **Phase 1: 音频引擎核心**

1. 项目脚手架 — pnpm monorepo, Vite + React + TS, TailwindCSS
2. `WavetableSynth` 类 — 多振荡器管理, 标准波形 + 自定义波表, PeriodicWave
3. `FilterChain` — LP/HP/BP/Notch, cutoff/resonance, 滤波器包络
4. `Envelope` (ADSR) — AudioParam automation
5. `LFO` — 调制波表位置/滤波器/音量/声像
6. `EffectsRack` — Reverb/Delay/Chorus/Distortion/Compressor
7. `SynthState` 统一状态模型 — JSON 序列化, Zustand store 双向绑定

### **Phase 2: 合成器 UI**

8. 深色科技感设计系统 — CSS 变量 + Tailwind 自定义主题
9. 核心组件 — `Knob`(SVG旋钮), `Slider`, `WaveformSelector`, `ADSRDisplay`(可拖拽), `VirtualKeyboard`
10. 主界面布局 — 顶栏(预设/导出/Agent) | 左(振荡器) | 中(滤波/包络/LFO) | 右(效果器) | 底(键盘+序列器)
11. 可视化 — 示波器, FFT 频谱, 波表 2D/3D 视图

### **Phase 3: 序列器/编曲**

12. Step Sequencer — 16/32 步网格, Tone.js Transport, BPM 可调
13. Piano Roll（简化版）— 拖拽编辑, 量化吸附
14. 多轨道支持 — 4-8 轨独立合成器 + 混音器

### **Phase 4: 后端服务**

15. Node.js API — Fastify + Prisma + PostgreSQL
16. 数据模型 — User / Preset / Project / AgentSession
17. API 端点 — Auth(JWT) + CRUD Presets/Projects
18. WebSocket 服务 — Agent 操作实时推送

### **Phase 5: AI Agent 系统（核心创新）**

19. LLM 抽象层 — 统一 `chat(messages, tools)` 接口, 4 家适配器
20. 合成器工具集 — `read_synth_state`, `set_oscillator`, `set_filter`, `set_envelope`, `set_effect`, `set_lfo`, `play_note`, `sequence_pattern`, `create_automation`, `save_preset`, `explain_concept`
21. Agent 核心循环 — ReAct 模式: User → System Prompt(含当前状态快照) → LLM → Tool Call → Execute → Feedback → Loop
22. System Prompt — 注入参数范围/音乐理论/当前状态, 角色=制作人+专家+老师
23. 安全护栏 — 参数范围校验, 操作频率限制, 用户优先规则, 全操作可撤销
24. Agent 前端面板 — 聊天窗口, 思考过程可视化, 操作历史, 快捷指令

### **Phase 6: 导出与持久化**

25. 音频导出 — OfflineAudioContext → WAV
26. 项目保存/加载 — JSON (SynthState + SequencerState) 存 PostgreSQL
27. 预设系统 — 保存/加载/浏览

### **Phase 7: i18n + 部署**

28. react-i18next 中英双语
29. Docker Compose — frontend(nginx) + api-server + agent-server + postgresql
30. 域名/HTTPS/反向代理

---

### 关键文件

- `packages/frontend/src/engine/WavetableSynth.ts` — 波表合成核心
- `packages/frontend/src/stores/synthStore.ts` — 状态管理, AI读写的桥梁
- `packages/frontend/src/components/synth/Knob.tsx` — 旋钮组件(全局复用)
- `packages/frontend/src/visualizers/` — 波形/频谱可视化
- `packages/api-server/prisma/schema.prisma` — 数据模型
- `packages/agent-server/app/tools/synth_tools.py` — Agent 工具定义
- `packages/agent-server/app/agent/core.py` — Agent ReAct 循环
- `packages/agent-server/app/providers/base.py` — LLM 统一抽象

### 项目结构

```
WaveSynAgent/
├── packages/
│   ├── frontend/          # React 前端
│   │   ├── src/
│   │   │   ├── engine/        # 音频引擎封装
│   │   │   ├── components/    # UI 组件
│   │   │   ├── stores/        # Zustand 状态
│   │   │   ├── visualizers/   # 可视化模块
│   │   │   ├── agent/         # Agent 前端交互
│   │   │   ├── i18n/          # 国际化
│   │   │   └── pages/         # 页面
│   │   └── public/
│   ├── api-server/        # Node.js API 服务
│   │   ├── src/
│   │   │   ├── routes/        # REST API
│   │   │   ├── ws/            # WebSocket 处理
│   │   │   ├── db/            # Prisma schema & 迁移
│   │   │   └── services/      # 业务逻辑
│   │   └── prisma/
│   └── agent-server/      # Python AI Agent 服务
│       ├── app/
│       │   ├── agent/         # Agent 核心逻辑
│       │   ├── tools/         # 合成器工具定义
│       │   ├── providers/     # LLM 提供商抽象
│       │   └── api/           # FastAPI 路由
│       └── tests/
├── docker-compose.yml
├── .env.example
└── README.md
```

### 验证

1. 播放各波形, 调参无爆音/卡顿, ADSR 包络曲线正确
2. 所有旋钮/推子响应灵敏, 可视化与音频同步
3. 序列器节拍准确, Piano Roll 编辑流畅
4. Agent 对话 → 参数变化 → 声音变化全链路验证, 多 LLM 切换正常
5. WAV 导出正确, 预设保存/加载无损
6. 端到端: 新用户注册 → 调音色 → 问 Agent → 导出完整流程

### 决策

- MVP 范围: 引擎 + UI + 序列器 + Agent, 暂不含社区/分享
- Agent 通过 WebSocket 推送操作到前端, 前端执行实际音频参数变更
- Yjs CRDT 解决 Agent 与用户同时操作的冲突
- 用户操作优先于 Agent（500ms 内用户修改过的参数 Agent 不覆盖）
