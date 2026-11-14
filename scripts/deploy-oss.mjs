#!/usr/bin/env node
/**
 * 把 public/ 同步到 S3 兼容对象存储（用于 CDN 回源）
 * 凭据从环境变量读取，或从 ~/.config/dsh/h2zbmh_oss.cred（KEY=VALUE 每行）读取。
 *   OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY / OSS_SECRET_KEY / OSS_REGION
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
// 媒体目录：源码里的图片单独传，不进 Pages 仓库
const MEDIA_DIRS = [
  { dir: path.join(ROOT, 'source', 'images'), prefix: 'images/' },
  { dir: path.join(ROOT, 'theme', 'assets', 'img'), prefix: 'assets/img/' },
];

function readCred() {
  const f = path.join(os.homedir(), '.config/dsh/h2zbmh_oss.cred');
  if (!fs.existsSync(f)) return {};
  const out = {};
  for (const line of fs.readFileSync(f, 'utf8').trim().split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const cred = readCred();
const endpoint = process.env.OSS_ENDPOINT || cred.endpoint || 'https://cn-sy1.rains3.com';
const bucket = process.env.OSS_BUCKET || cred.bucket;
const access = process.env.OSS_ACCESS_KEY || cred.access;
const secret = process.env.OSS_SECRET_KEY || cred.secret;
const region = process.env.OSS_REGION || 'cn-sy1';

if (!bucket || !access || !secret) {
  console.error('缺少凭据：设置 OSS_BUCKET / OSS_ACCESS_KEY / OSS_SECRET_KEY 或写入 ~/.config/dsh/h2zbmh_oss.cred');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const s3 = new S3Client({
  region, endpoint, forcePathStyle: true,
  credentials: { accessKeyId: access, secretAccessKey: secret },
});

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push({ full, key: path.relative(base, full).split(path.sep).join('/') });
  }
  return out;
}

const files = walk(PUBLIC);
for (const { dir, prefix } of MEDIA_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    files.push({ full: f.full, key: prefix + f.key });
  }
}
console.log(`uploading ${files.length} files → s3://${bucket}/`);
let ok = 0, fail = 0;
const queue = [...files];
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    const ext = path.extname(f.key).toLowerCase();
    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: f.key, Body: fs.readFileSync(f.full),
        ContentType: MIME[ext] || 'application/octet-stream',
        ACL: 'public-read',
      }));
      ok++;
    } catch (e) {
      fail++;
      if (fail <= 5) console.log('FAIL', f.key, e.name, String(e.message).slice(0, 90));
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`done: ${ok} ok, ${fail} failed`);
if (fail) process.exit(1);
