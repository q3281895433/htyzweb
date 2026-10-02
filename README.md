# 会同一中学生社区中心

这是 `htyz.space` 的应用源码与构建产物，供 VS Code 打开和继续开发。目录包含前端 `src/`、服务端 `server/`、集成测试 `tests/`、部署脚本 `deploy/`、构建产物 `dist/` 和项目说明。给 GPT-6 Sol 的续作要求在 [GPT6_SOL_PROMPT.md](GPT6_SOL_PROMPT.md)。

本目录不包含生产数据库、用户上传文件、`.env`、SMTP 密钥或管理员密码；这些仍留在服务器，不能提交到代码仓库。`node_modules` 是本地生成依赖，不属于项目源码，未随桌面交付复制。开发前在本目录运行 `npm ci`；建议使用服务器同系的 Node 18.20+，或在其他版本上重新编译 `better-sqlite3`。运行 `npm run build` 构建前端，`npm test` 执行临时数据库集成测试。将 `.env.example` 复制为本地 `.env` 后可运行 `npm run dev:server` 和 `npm run dev`。不要把真实生产 `.env` 或数据库复制进开发目录。

当前线上部署目录是 `/opt/htyz`。发布前请先跑测试并备份数据库，参考 `deploy/install-release.sh` 的范围与回滚逻辑；它不会用本目录的数据覆盖生产 `data/` 和 `uploads/`。

媒体上传使用磁盘流式接收：临时文件位于受限的 `uploads/` 目录，验证文件格式后原子地加入正式文件名，成功或失败均清理临时文件。普通帖子每次最多 9 张图片（每张遵守 `.env` 中 `UPLOAD_MAX_MB`，目前生产为 6 MB）与 1 个不超过 50 MB 的视频，总请求不得超过 110 MB。图片仅在可用工具存在时进行限时无损优化。部署时还须使用 `deploy/install-nginx-config.sh` 安装经 `nginx -t` 验证的配置，使反向代理接受 110 MB 请求。

## 视频自动转码（2026-09-25 上线）

上传的视频由后台**全自动**处理成浏览器可直接播放的格式，用户无需做任何操作。

**为什么需要**：大疆无人机默认录制 H.265/HEVC + 10-bit（HLG/D-Log），容器多为 MOV。Chrome / Firefox 完全不支持 HEVC，10-bit 更是普遍无法解码，因此上传后播放会报「视频格式错误」。

**为什么不在请求内同步转码**：1 核 CPU 转 4K 需要较长时间，阻塞上传会让用户久等。改为上传立即返回（实测 **218 ms**），转码在后台队列进行。

处理策略（按代价从低到高）：

| 源文件情况 | 处理方式 | 实测耗时 |
|---|---|---|
| 已是 H.264 8-bit 且宽度 ≤1920 | 仅重封装（faststart），不重新编码 | 秒级 |
| HEVC / 10-bit / 超 1080p / 非标准色彩 | 转码为 1080p H.264 8-bit bt709 | 4K·8 秒素材约 15 秒 |
| 无法解析（损坏） | 标记失败，接口返回可读原因 | — |

**实现要点**：

- `server/video-queue.js` —— 队列表 `video_jobs` 落库，进程重启/断电不丢任务；启动时把卡在 `processing` 的任务重新排队；定期清理无引用的临时文件
- `server/video-worker.js` —— 串行 worker（并发恒为 1），ffmpeg 以 `nice 10` 运行；单任务 15 分钟超时；产物先写临时文件再原子替换（同名替换，前端 URL 不变）
- 转码时同时抽取封面帧；列表页只加载封面，点击才加载视频本体
- 默认 `-map_metadata -1` 清除大疆写入的 GPS、飞行轨迹、设备序列号
- `ensureVideoSchema` 在 `createApp` 阶段执行，使只读路径与自动化测试都能安全查询新字段

**资源保护**（`deploy/htyz.service`）：`MemoryMax=640M`（原 320M，4K 解码峰值更高）、`CPUQuota=85%`（硬性上限，保证 nginx/node 始终有 CPU）、`TasksMax=256`。worker 的临时文件放在 `uploads/` 内，不依赖系统 `/tmp`，与 `PrivateTmp=true` 不冲突。

实测：转码期间网站响应 **7–11 ms**（空闲 9 ms），负载不超过 0.40。

**前端行为**（`src/components/PostMedia.jsx`）：视频有三种状态 ——

- `processing` —— 封面 + 「视频处理中，稍后自动可播」，轮询 `/api/media/video/:id/status`，完成后自动切换为可播放，**无需刷新页面**
- `ready` —— 封面 + 播放按钮，点击才加载视频
- `failed` —— 显示可读原因，替代浏览器原生的「格式错误」

接口在 `processing` 时返回 **409**、`failed` 时返回 **422**（JSON），不再把未完成的字节流交给 `<video>` —— 这正是「视频格式错误」的修复点。

### 发布注意事项（重要）

`install-release.sh` 会先 `chmod` 规范化权限再 `chown`。**这一步不可省略**：本地文件可能因 umask 为 `0600`，原样打包后 `htyz` 服务用户读不到代码，服务会启动失败。发布前建议确认本地权限：

```bash
find server src tests deploy -type f -exec chmod 644 {} \;
```

### 本地跑测试

测试需要 `ffmpeg`/`ffprobe` 与真实视频素材。素材在运行时现场生成（不提交二进制）；若本机没有 ffmpeg，相关用例会自动跳过。可复用转码工具自带的二进制：

```bash
cd tools/dji-convert && npm install     # 提供 ffmpeg/ffprobe
cd ../.. && node --test "tests/*.test.js"
```

注意本地 `node` 若被解析为 Electron（`process.versions.electron` 存在），ABI 与 `better-sqlite3` 不匹配，需改用真实的 Node 18/20/22。

2026-09-24 排查出服务器上已停用的 XJCJ 站点健康检查每两分钟重启一次共用 Nginx；其定时器 `xjcj-healthcheck.timer` 已禁用，脚本和 unit 未删除。只有在恢复该旧站并修正其检查目标后，才应重新启用定时器。
