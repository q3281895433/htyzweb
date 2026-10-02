#!/usr/bin/env node
/**
 * 大疆视频一键转换工具
 * ------------------------------------------------------------
 * 把大疆无人机/运动相机拍摄的 HEVC 10-bit 视频，转成所有浏览器
 * 都能直接播放的 1080p H.264 MP4。
 *
 * 为什么需要它：
 *   大疆默认录制 H.265/HEVC + 10-bit（HLG/D-Log），容器多为 MOV。
 *   Chrome / Firefox 完全不支持 HEVC，10-bit 更是普遍无法硬件解码，
 *   所以上传后浏览器会报「视频格式错误」。
 *
 * 为什么不在服务器转码：
 *   实测 1 核 CPU 编码 5 秒 4K HEVC 需 5 分钟以上，且期间整站不可用。
 *   在你自己电脑上转（硬件加速）只要几十秒。
 *
 * 用法：
 *   node convert.mjs                  # 处理 input/ 目录下所有视频
 *   node convert.mjs 视频1.MP4 视频2.MP4   # 处理指定文件
 *   node convert.mjs --4k             # 保留 4K（默认降到 1080p）
 *   node convert.mjs --keep-meta      # 保留 GPS 等元数据（默认清除）
 *   node convert.mjs --dry-run        # 只显示将要执行的操作
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(HERE, 'input');
const OUTPUT_DIR = path.join(HERE, 'output');
const BIN_DIR = path.join(HERE, '.bin');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.hevc', '.265', '.insv', '.lrv']);

// ============================================================
// 参数解析
// ============================================================
const argv = process.argv.slice(2);
const flags = {
  keep4k: argv.includes('--4k'),
  keepMeta: argv.includes('--keep-meta'),
  dryRun: argv.includes('--dry-run'),
  help: argv.includes('--help') || argv.includes('-h'),
};
const fileArgs = argv.filter((a) => !a.startsWith('--') && !a.startsWith('-'));

if (flags.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
  process.exit(0);
}

const log = (...a) => console.log(...a);
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
const ok = (m) => log(`${C.green}✅ ${m}${C.reset}`);
const warn = (m) => log(`${C.yellow}⚠️  ${m}${C.reset}`);
const err = (m) => log(`${C.red}❌ ${m}${C.reset}`);
const info = (m) => log(`${C.cyan}ℹ️  ${m}${C.reset}`);

// ============================================================
// 定位 ffmpeg / ffprobe
// ============================================================
function findInPath(name) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(which, [name], { encoding: 'utf8' });
  if (r.status === 0) {
    const first = (r.stdout || '').split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first.trim())) return first.trim();
  }
  return null;
}

/** 在 node_modules 里查找 @ffmpeg-installer 提供的二进制 */
function findBundled(name) {
  // 注意：Apple Silicon 是 darwin-arm64，与 Intel 的 darwin-x64 不同包
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64';
  const platformPkg = {
    darwin: `darwin-${arch}`,
    win32: `win32-${arch}`,
    linux: `linux-${arch}`,
  }[process.platform];

  if (!platformPkg) return null;
  const exe = process.platform === 'win32' ? '.exe' : '';

  const candidates = [
    path.join(HERE, 'node_modules', '@ffmpeg-installer', platformPkg, name + exe),
    path.join(HERE, 'node_modules', '@ffprobe-installer', platformPkg, name + exe),
    path.join(HERE, '.bin', name + exe),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function locateTool(name) {
  const bundled = findBundled(name);
  if (bundled) {
    // npm 出于安全策略会跳过 postinstall 的 chmod，导致二进制没有执行权限。
    // 这里自动补上，避免用户遇到 "spawn EACCES" 却不知所措。
    if (process.platform !== 'win32') {
      try {
        const mode = fs.statSync(bundled).mode;
        if (!(mode & 0o111)) fs.chmodSync(bundled, mode | 0o755);
      } catch { /* 权限不足时继续，后续 spawn 会给出明确报错 */ }
    }
    return bundled;
  }
  return findInPath(name);
}

/** 验证二进制真的能跑（有些下载不完整或架构不匹配） */
function verifyTool(bin, name) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 20000 });
  if (r.status === 0) return true;
  warn(`${name} 无法执行：${(r.stderr || r.error?.message || '').split('\n')[0]}`);
  return false;
}

let FFMPEG = locateTool('ffmpeg');
let FFPROBE = locateTool('ffprobe');

if (FFMPEG && !verifyTool(FFMPEG, 'ffmpeg')) FFMPEG = findInPath('ffmpeg');
if (FFPROBE && !verifyTool(FFPROBE, 'ffprobe')) FFPROBE = findInPath('ffprobe');

if (!FFMPEG || !FFPROBE) {
  warn('未找到 ffmpeg / ffprobe，视频转换需要它们。');
  log('');
  log('  ' + C.bold + '请在本文件夹执行下面这一条命令自动安装（约 70MB，国内网络可用）：' + C.reset);
  log('  ' + C.cyan + '    npm install' + C.reset);
  log('');
  log('  或手动安装 ffmpeg 后重新运行本工具。');
  log('');
  process.exit(1);
}

// ============================================================
// 探测视频信息
// ============================================================
function probe(file) {
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,channels',
    '-show_entries', 'format=format_name,duration,size,bit_rate',
    '-of', 'json',
    file,
  ];
  const r = spawnSync(FFPROBE, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const a = (j.streams || []).find((s) => s.codec_type === 'audio');
    if (!v) return null;
    return {
      format: j.format?.format_name || '',
      duration: parseFloat(j.format?.duration || '0'),
      size: parseInt(j.format?.size || '0', 10),
      video: {
        codec: v.codec_name,
        profile: v.profile || '',
        pixFmt: v.pix_fmt || '',
        width: v.width || 0,
        height: v.height || 0,
        fps: v.r_frame_rate || '',
      },
      audio: a ? { codec: a.codec_name, channels: a.channels || 0 } : null,
    };
  } catch {
    return null;
  }
}

/** 判断这段视频浏览器能否直接播放 */
function diagnose(info) {
  const reasons = [];
  const v = info.video;

  if (v.codec !== 'h264') {
    reasons.push(`视频编码是 ${v.codec.toUpperCase()}，浏览器需要 H.264`);
  }
  if (/10le|10be|p010|12le/.test(v.pixFmt)) {
    reasons.push(`位深是 10-bit（${v.pixFmt}），浏览器需要 8-bit`);
  }
  if (v.profile && /main 10|main10|high 10/i.test(v.profile)) {
    reasons.push(`编码档次为 ${v.profile}，浏览器不支持`);
  }
  if (/mov|qt/i.test(info.format) && /qt/i.test(info.format)) {
    reasons.push('容器是 QuickTime(MOV)，建议转为 MP4');
  }
  if (info.audio && !['aac', 'mp3', 'opus', 'vorbis'].includes(info.audio.codec)) {
    reasons.push(`音频编码 ${info.audio.codec} 兼容性差，建议转 AAC`);
  }
  if (v.width > 1920 && !flags.keep4k) {
    reasons.push(`分辨率 ${v.width}×${v.height} 超出 1080p，将自动缩放`);
  }
  return reasons;
}

function human(bytes) {
  if (!bytes) return '—';
  const mb = bytes / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
}

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// ============================================================
// 构建转码参数
// ============================================================
function buildArgs(input, output, info) {
  const scaleTarget = flags.keep4k ? null : 1920;

  // 缩放宽高：只在超过目标宽度时才缩小，绝不放大
  const scale = scaleTarget
    ? `scale='if(gt(iw,${scaleTarget}),${scaleTarget},iw)':-2:flags=lanczos`
    : null;

  const vf = [scale, 'format=yuv420p'].filter(Boolean).join(',');

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-stats',
    '-nostdin',
    '-y',
    '-i', input,
    // ---- 视频 ----
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', flags.keep4k ? '5.1' : '4.1',
    '-preset', 'medium',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    // 色彩统一到网页标准 bt709：修正大疆 HLG / D-Log 的偏色
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    // ---- 音频 ----
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    // ---- 容器 ----
    '-movflags', '+faststart',
  ];

  // 默认清除元数据：大疆视频内含 GPS 坐标、飞行轨迹、设备序列号
  if (!flags.keepMeta) args.push('-map_metadata', '-1');

  args.push(output);
  return args;
}

// ============================================================
// 执行转码
// ============================================================
function runFfmpeg(args, durationSec) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stderrTail = '';
    let lastLine = '';

    child.stderr.on('data', (buf) => {
      const text = buf.toString();
      stderr += text;
      // ffmpeg 的 -stats 进度用 \r 原地刷新，必须按 \r 与 \n 同时切分，
      // 否则一次 read 里只有最后一段能被读到，进度条会长时间不动。
      const chunks = text.split(/[\r\n]+/).filter((c) => c.trim());
      for (const chunk of chunks) {
        const m = /time=(\d+):(\d+):(\d+)/.exec(chunk);
        if (m && durationSec > 0) {
          const done = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
          const pct = Math.min(100, Math.round((done / durationSec) * 100));
          const bar = '█'.repeat(Math.floor(pct / 4)).padEnd(25, '░');
          lastLine = `    ${bar} ${String(pct).padStart(3)}%`;
          process.stdout.write('\r' + lastLine);
        }
      }
      // 只保留真正的错误行，避免把进度行混进失败诊断
      const errOnly = chunks.filter((c) => !/time=\d+:\d+:\d+/.test(c) && !/^(frame|video|size)=/.test(c));
      if (errOnly.length) stderrTail = errOnly.slice(-8).join('\n');
    });

    child.on('error', (e) => resolve({ code: -1, stderr: String(e) }));
    child.on('close', (code) => {
      if (lastLine) process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r');
      resolve({ code, stderr: stderrTail || stderr });
    });
  });
}

// ============================================================
// 主流程
// ============================================================
function collectInputs() {
  if (fileArgs.length) {
    return fileArgs.filter((f) => fs.existsSync(f)).map((f) => path.resolve(f));
  }
  if (!fs.existsSync(INPUT_DIR)) {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(INPUT_DIR)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => !f.startsWith('.'))
    .map((f) => path.join(INPUT_DIR, f))
    .filter((f) => fs.statSync(f).isFile());
}

async function main() {
  log('');
  log(`${C.bold}大疆视频一键转换工具${C.reset}`);
  log(`${C.dim}把 HEVC 10-bit 视频转成浏览器可直接播放的 H.264 MP4${C.reset}`);
  log('');

  info(`ffmpeg: ${FFMPEG}`);
  info(`输出规格: ${flags.keep4k ? '保留原分辨率（最高 4K）' : '1080p'} / H.264 High / 8-bit / bt709 / AAC`);
  if (!flags.keepMeta) info('元数据: 将清除（含大疆 GPS 与飞行遥测，保护隐私）');

  const inputs = collectInputs();
  if (!inputs.length) {
    log('');
    warn(`没有找到待转换的视频。`);
    log('');
    log('  用法一：把视频文件拖到「一键转换.command / .bat」上');
    log(`  用法二：把视频放进这个文件夹后重新运行：`);
    log(`          ${INPUT_DIR}`);
    log('  用法三：命令行指定文件：');
    log('          node convert.mjs 我的视频.MP4');
    log('');
    process.exit(0);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  log('');
  log(`${C.bold}待处理 ${inputs.length} 个文件${C.reset}`);
  log('');

  const results = [];

  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i];
    const name = path.basename(input);
    log(`${C.bold}[${i + 1}/${inputs.length}] ${name}${C.reset}`);

    const stat = fs.statSync(input);
    if (stat.size === 0) { err('文件为空，跳过'); results.push({ name, status: 'skip' }); continue; }

    const info = probe(input);
    if (!info) { err('无法读取视频信息（文件可能损坏或不是视频）'); results.push({ name, status: 'fail' }); continue; }

    const v = info.video;
    log(`    原始: ${v.codec.toUpperCase()} ${v.profile || ''} ${v.pixFmt} ${v.width}×${v.height} `
      + `${v.fps} ${fmtTime(info.duration)} ${human(info.size)}`);
    if (info.audio) log(`    音频: ${info.audio.codec} ${info.audio.channels}ch`);

    const problems = diagnose(info);
    if (problems.length) {
      log(`    ${C.yellow}需要转换的原因:${C.reset}`);
      for (const p of problems) log(`      · ${p}`);
    } else {
      log(`    ${C.green}该视频已符合浏览器要求，仍会统一规格以确保一致性${C.reset}`);
    }

    const base = path.basename(input, path.extname(input)).replace(/[\\/:*?"<>|]/g, '_');
    let output = path.join(OUTPUT_DIR, `${base}-网页版.mp4`);
    let n = 2;
    while (fs.existsSync(output)) output = path.join(OUTPUT_DIR, `${base}-网页版(${n++}).mp4`);

    const args = buildArgs(input, output, info);

    if (flags.dryRun) {
      info('--dry-run：跳过实际转换');
      log(`    ffmpeg ${args.join(' ')}`);
      results.push({ name, status: 'dry' });
      continue;
    }

    log(`    转换中…（大疆 4K 素材通常需要 30 秒 ~ 3 分钟，取决于电脑性能）`);
    const t0 = Date.now();
    const { code, stderr } = await runFfmpeg(args, info.duration);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (code !== 0 || !fs.existsSync(output)) {
      err(`转换失败（${elapsed}s）`);
      const lines = stderr.split('\n').filter(Boolean).slice(-6);
      for (const l of lines) log(`      ${C.dim}${l}${C.reset}`);
      try { fs.unlinkSync(output); } catch { /* ignore */ }
      results.push({ name, status: 'fail' });
      continue;
    }

    const outStat = fs.statSync(output);
    const outInfo = probe(output);
    const ratio = stat.size ? Math.round((1 - outStat.size / stat.size) * 100) : 0;

    ok(`完成（${elapsed}s）`);
    log(`    输出: ${path.basename(output)}`);
    log(`    规格: ${outInfo?.video.codec.toUpperCase()} ${outInfo?.video.pixFmt} `
      + `${outInfo?.video.width}×${outInfo?.video.height} ${human(outStat.size)}`);
    log(`    体积: ${human(stat.size)} → ${human(outStat.size)}（${ratio > 0 ? '减少 ' + ratio + '%' : '增加 ' + (-ratio) + '%'}）`);
    log('');

    results.push({ name, output: path.basename(output), status: 'ok', before: stat.size, after: outStat.size });
  }

  // ---------- 汇总 ----------
  log('═'.repeat(60));
  const done = results.filter((r) => r.status === 'ok');
  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'skip');

  log(`${C.bold}处理完成${C.reset}`);
  log(`  成功 ${done.length} 个${failed.length ? `，失败 ${failed.length} 个` : ''}${skipped.length ? `，跳过 ${skipped.length} 个` : ''}`);

  if (done.length) {
    log('');
    log(`  ${C.green}转换后的文件在：${C.reset}`);
    log(`  ${OUTPUT_DIR}`);
    log('');
    log(`  ${C.bold}下一步：把这些「-网页版.mp4」上传到网站即可。${C.reset}`);
    log(`  ${C.dim}原文件没有被修改或删除。${C.reset}`);
  }
  if (failed.length) {
    log('');
    err('以下文件转换失败：');
    for (const f of failed) log(`    · ${f.name}`);
    log(`  ${C.dim}常见原因：文件损坏、磁盘空间不足、或视频带有加密保护。${C.reset}`);
  }
  log('');
}

main().catch((e) => {
  err('工具异常退出：' + (e?.stack || e));
  process.exit(1);
});
