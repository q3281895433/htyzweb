# htyz.space 视频兼容与阅览优化方案

> 针对「大疆视频上传后播放报格式错误」的完整解决方案
> 状态：**设计稿 + 代码，未部署**（等待确认）

---

## 一、问题定位

### 1.1 根因

大疆无人机默认录制格式与浏览器播放要求存在**三重冲突**：

| 维度 | 大疆默认输出 | 浏览器要求 | 冲突 |
|---|---|---|---|
| 视频编码 | **H.265 / HEVC** | H.264 (AVC) | ❌ Chrome / Firefox 完全不支持 HEVC |
| 位深 | **10-bit**（HLG / D-Log） | 8-bit | ❌ 硬件解码器普遍不支持 |
| 容器 | **MOV**（`ftyp qt`） | MP4（`isom` / `mp42`） | ⚠️ 部分浏览器不支持 |
| 色彩空间 | HLG / D-Log | bt709 | ❌ 即使能播也严重偏色 |

现有后端的 `checkedVideo()` **只校验 `bytes[4..8] === 'ftyp'`**，因此：
- QuickTime MOV 会被当作 MP4 收下（`qt` 品牌也含 `ftyp`）
- HEVC 编码完全不做检查

### 1.2 为什么不能在服务器上转码

实测数据（本机 1 核 AMD EPYC 7R13）：

| 任务 | 实测结果 |
|---|---|
| 编码 5 秒 4K HEVC 10-bit | **> 5 分钟未完成** |
| 同期服务器负载 | **21.92**（1 核 → 22 倍过载） |
| 同期网站可用性 | **整站不可用**（443 超时） |

推算：1 分钟 4K 素材 ≈ 60 分钟以上，期间网站持续瘫痪。

**结论：1 核 CPU 上服务端转码不可行，不是参数问题而是硬件量级问题。**

（服务器 ffmpeg 虽列有 `h264_nvenc` / `h264_qsv`，但这是虚拟机，无对应硬件。）

---

## 二、方案总览

```
                    ┌─────────────────────────────────────┐
   大疆拍摄视频  ──▶ │  路线 B：本机转码脚本（主力）        │
   (HEVC 10-bit)    │  一键把 4K HEVC 转成 1080p H.264     │
                    │  稳定、可批量、服务器零压力          │
                    └──────────────┬──────────────────────┘
                                   │ 转好的 H.264 MP4
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  路线 A：网页端转码（便利补充）      │
                    │  WebCodecs 硬解 → 编码 H.264 → 上传   │
                    │  仅小文件；不支持时自动提示用脚本     │
                    └──────────────┬──────────────────────┘
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  服务端：只做校验，不做转码          │
                    │  · 严格校验编码（拒绝 HEVC/10-bit）  │
                    │  · 抽封面图                          │
                    │  · 已合规的文件仅 rewrap + faststart │
                    └──────────────┬──────────────────────┘
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  阅览：封面图 + 点击播放             │
                    │  · 列表页只加载封面，不加载视频       │
                    │  · onError 明确提示，不再显示浏览器原生报错 │
                    └─────────────────────────────────────┘
```

---

## 三、路线 B：本机转码脚本（主力方案）

### 3.1 设计目标

| 目标 | 做法 |
|---|---|
| 双击即用 | Windows `.bat` + macOS `.command`，无需命令行 |
| 免装 ffmpeg | 脚本自动检测；缺失时自动下载静态版（Mac/Win 各一份） |
| 批量处理 | 拖入整个文件夹，或把文件放进 `input/` 目录 |
| 参数合理 | 1080p / H.264 High / CRF 23 / 8-bit / bt709 / AAC 128k / faststart |
| 保留原片 | 输出到 `output/`，绝不覆盖原文件 |
| 有进度可见 | 显示每个文件的处理进度与耗时 |
| 失败可诊断 | 出错时打印 ffmpeg 命令与原因，不静默失败 |

### 3.2 转码参数与理由

```bash
ffmpeg -i 输入.MP4 \
  -vf "scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -profile:v high -level 4.1 -preset medium -crf 23 \
  -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 128k -ac 2 \
  -movflags +faststart \
  -map_metadata -1 \
  输出.mp4
```

| 参数 | 作用 |
|---|---|
| `scale='min(1920,iw)':-2` | 4K → 1080p；**已经是 1080p 或更低则不放大** |
| `flags=lanczos` | 高质量缩放 |
| `format=yuv420p` + `-pix_fmt yuv420p` | **10-bit → 8-bit**（关键，10-bit 浏览器放不了） |
| `-profile:v high -level 4.1` | 最广兼容档位（Level 4.1 覆盖 1080p30） |
| `crf 23` + `preset medium` | 画质与体积平衡点 |
| `bt709` 三件套 | **修正 HLG/D-Log 偏色**，转成网页标准色彩 |
| `-map_metadata -1` | 去掉大疆的 GPS / 云台遥测等隐私元数据 |
| `+faststart` | moov 前置，边下边播 |
| `-ac 2` | 5.1 声道降为立体声（浏览器兼容性更好） |

**额外的隐私处理**：大疆视频默认写入 GPS 坐标、飞行轨迹、遥控器序列号。`-map_metadata -1` 会清掉这些——用户在校园社区发布视频时，不应泄露拍摄位置。**这一点值得单独提示用户。**

---

## 四、路线 A：网页端转码（便利补充）

### 4.1 可行性

| 能力 | 用途 | 支持情况 |
|---|---|---|
| `VideoDecoder` (WebCodecs) | 解码 HEVC —— **用用户设备的硬件解码器**，不占服务器 | Chrome 94+ / Safari 16.4+ / Edge |
| `VideoEncoder` | 编码 H.264（通常也是硬件加速） | 同上 |
| `mp4-muxer` | 把编码后的 H.264 封装成 MP4 | 纯 JS，约 30KB |

**关键点：解码用的是用户自己的设备。** 用户的 Mac/PC 解码 4K HEVC 是硬件加速的（1 分钟素材约 10–30 秒），而服务器做同样的事需要 60 分钟。

### 4.2 流程

```
用户选择视频
   │
   ├─ 探测：是否 HEVC？是否 10-bit？分辨率？
   │
   ├─ 已合规（H.264 8-bit MP4）→ 直接上传，不转码
   │
   └─ 需要转码
        ├─ 浏览器支持 WebCodecs → 页面内转码（显示进度）→ 上传
        └─ 不支持 → 提示下载本机脚本，并说明原因
```

### 4.3 不支持时的兜底

`MediaCapabilities.decodingInfo()` 或直接尝试 `VideoDecoder.isConfigSupported()` 探测。不支持时展示明确指引：

> 你的浏览器无法直接转换这种视频（大疆的 H.265 格式）。
> 请用下方工具在电脑上转换后再上传 —— 点此下载。

---

## 五、服务端改动（只校验，不转码）

| 改动 | 说明 |
|---|---|
| **严格校验编码** | 用 `ffprobe` 读取真实编码；**拒绝 HEVC / 10-bit / 非 bt709**（若客户端已转码则不会命中），并返回可操作的错误提示 |
| **修正 MIME 判定** | 按真实 `brand` 判断 MP4 / MOV，不再一律标 `video/mp4` |
| **抽封面图** | `ffmpeg -ss 1 -frames:v 1 -vf scale=1280:-2` → 存为 jpg，写入 `post_videos` 或新表 |
| **rewrap 而非转码** | 已合规的文件只做 `-c copy -movflags +faststart`（秒级完成，1 核无压力） |
| **放弃全量转码** | 删除 `optimizeUploadTemps` 中会压垮服务器的路径，改为"不可播就拒绝并提示" |
| **队列与限流** | 同一时刻最多 1 个 ffmpeg 任务（`optimizerBusy` 已有），并加 `nice` / `cpulimit` 保护 |

### 5.1 需要新增的数据库字段

```sql
ALTER TABLE post_videos ADD COLUMN poster_storage_name TEXT;
ALTER TABLE post_videos ADD COLUMN codec TEXT;        -- h264 / hevc
ALTER TABLE post_videos ADD COLUMN width INTEGER;
ALTER TABLE post_videos ADD COLUMN height INTEGER;
ALTER TABLE post_videos ADD COLUMN duration_seconds REAL;
```

---

## 六、阅览侧优化

### 6.1 封面图 + 点击播放

现有实现是 9 个视频会同时开始加载元数据，流量和首屏都很重。

```
改前：列表页 ──▶ <video preload="metadata"> × N  ← 每个都发请求
改后：列表页 ──▶ <img src=封面>              ← 只加载一张小图
                 点击后 ──▶ 替换为 <video autoplay controls>
```

### 6.2 错误兜底（你最初发现的问题）

```jsx
<video
  src={video}
  poster={poster}
  onError={(e) => setError(classifyMediaError(e))}
/>
```

把浏览器原生的"格式不正确"替换为可操作提示：

| 情况 | 提示 |
|---|---|
| 需要登录 | 该视频需要登录后观看，请先登录 |
| 无权限（帖子已删除） | 该视频已不可访问 |
| 编码不支持 | 该视频编码浏览器无法播放，请联系发布者用工具转换后重新上传 |
| 网络问题 | 视频加载失败，请检查网络后重试 |

**注意**：`<video>` 的 `error` 事件拿不到 HTTP 状态码，所以前端需先用 `fetch` 探测状态码再决定提示文案（或由后端在视频 URL 上加一个探测接口）。

---

## 七、改动清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `tools/dji-convert/convert.mjs` | 新增：跨平台一键转码脚本 | 无（本地工具） |
| `tools/dji-convert/一键转换.bat` | 新增：Windows 入口 | 无 |
| `tools/dji-convert/一键转换.command` | 新增：macOS 入口 | 无 |
| `src/lib/mediaConvert.js` | 新增：WebCodecs 转码逻辑 | 低（浏览器能力不足时降级） |
| `src/components/VideoPicker.jsx` | 改：探测 + 转码 + 进度 + 兜底 | 中 |
| `src/components/PostMedia.jsx` | 改：封面图 + 点击播放 + 错误分类 | 低 |
| `server/uploads.js` | 改：严格校验 + 抽封面 + 去掉全量转码 | **中**（核心路径） |
| `server/routes/content.js` | 改：视频响应加 poster 字段 | 低 |
| `server/db.js` | 改：新增字段（迁移） | **中**（需幂等迁移） |

---

## 八、实施顺序

1. **本机转码脚本**（路线 B）—— 立即可用，不依赖任何服务端改动
2. **服务端严格校验 + 封面抽取** —— 防止不合规文件再进来
3. **阅览侧封面图 + 错误兜底** —— 用户不再看到"格式不正确"
4. **网页端转码**（路线 A）—— 便利性提升，最后做

---

## 九、待确认

1. 本机转码脚本你需要在 **Windows 还是 macOS** 上跑？（决定我重点测哪个平台）
2. 转码目标分辨率：**1080p**（推荐，体积约原片 1/5）还是保留 **4K**（体积大、1 核服务器存储吃紧）？
3. 是否同意**默认清除大疆视频的 GPS/飞行遥测元数据**？（我建议清除，保护隐私）
4. 现有 4 个视频中，那 2 个 43.9MB 的归档视频要不要重新处理？
