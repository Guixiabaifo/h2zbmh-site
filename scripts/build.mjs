#!/usr/bin/env node
/**
 * 杭州二中白马湖学校官网静态站生成器
 * - 内容：source/_posts/*.md（YAML front matter，Hexo 约定）
 * - 输出：public/（首页、文章页、归档页、标签页、数据 JSON）
 * - 用法：node scripts/build.mjs [--watch] [--serve] [--port 8080]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'source');
const POSTS = path.join(SRC, '_posts');
const THEME = path.join(ROOT, 'theme');
const PUBLIC = path.join(ROOT, 'public');

const argv = process.argv.slice(2);
const WATCH = argv.includes('--watch');
const SERVE = argv.includes('--serve');
const PORT = Number((argv[argv.indexOf('--port') + 1] || 8080)) || 8080;

// 媒体外链前缀：图片/大头资源放对象存储，页面只引用链接
// 置空字符串则全部随站点一起发布
const MEDIA = process.env.MEDIA_BASE ?? 'https://h2zbmh.cn-sy1.rains3.com';

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });

/* ------------------------------------------------------------------ utils */
const read = (p) => fs.readFileSync(p, 'utf8');
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  ensure(to);
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

/** 极简 YAML front matter 解析：支持 key: value / [a, b] / 引号 */
function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = {};
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (!k) continue;
      if (v.startsWith('[') && v.endsWith(']')) {
        v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      } else {
        v = v.replace(/^['"]|['"]$/g, '');
      }
      data[k] = v;
    }
  }
  return { data, body };
}

const pad = (n) => String(n).padStart(2, '0');
function fmtDate(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function permalink(post) {
  const t = new Date(post.date);
  return `${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())}/${post.slug}/`;
}
const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ load posts */
function loadPosts() {
  if (!fs.existsSync(POSTS)) return [];
  const posts = [];
  for (const f of fs.readdirSync(POSTS).filter(f => /\.md$/i.test(f))) {
    const raw = read(path.join(POSTS, f));
    const { data, body } = parseFrontMatter(raw);
    const slug = path.basename(f, path.extname(f));
    const date = data.date || fs.statSync(path.join(POSTS, f)).mtime.toISOString();
    let html = md.render(body)
      .replace(/src="(?:\/)?images\//g, 'src="/images/')
      .replace(/href="(?:\/)?images\//g, 'href="/images/');
    const text = plain(html);
    posts.push({
      file: f, slug,
      title: data.title || slug,
      date: fmtDate(date),
      timestamp: new Date(date).getTime(),
      categories: data.categories || [],
      tags: data.tags || [],
      cover: data.cover ? data.cover.replace(/^\.?\//, '') : '',
      excerpt: data.excerpt || text.slice(0, 110),
      html, text,
      words: text.replace(/\s/g, '').length,
      url: permalink({ date, slug }),
    });
  }
  return posts.sort((a, b) => b.timestamp - a.timestamp);
}

/* ------------------------------------------------------------------ templates */
const T = (name) => read(path.join(THEME, 'templates', name));
let ARTICLE_TPL = '', SITE = null;

function renderPost(post, prev, next) {
  const cover = post.cover ? `../../${post.cover}` : '';
  return ARTICLE_TPL
    .replaceAll('{{TITLE}}', esc(post.title))
    .replaceAll('{{DESC}}', esc(post.excerpt))
    .replaceAll('{{DATE}}', post.date)
    .replaceAll('{{WORDS}}', String(post.words))
    .replaceAll('{{CATEGORY}}', esc(post.categories[0] || '校园新闻'))
    .replaceAll('{{BODY}}', post.html)
    .replaceAll('{{TAGS}}', post.tags.map(t => `<a href="../../tags/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join('') || '<a href="../../archives/">#校园新闻</a>')
    .replaceAll('{{PREV}}', prev ? `<a href="../../${prev.url}"><small>← 上一篇</small><strong>${esc(prev.title)}</strong></a>` : '<span></span>')
    .replaceAll('{{NEXT}}', next ? `<a class="right" href="../../${next.url}"><small>下一篇 →</small><strong>${esc(next.title)}</strong></a>` : '<span></span>')
    .replaceAll('{{COVER_META}}', cover ? `<meta property="og:image" content="${esc(cover)}">` : '');
}

function renderArchive(posts) {
  const years = {};
  for (const p of posts) (years[p.date.slice(0, 4)] ||= []).push(p);
  const blocks = Object.keys(years).sort().reverse().map(y => {
    const items = years[y].map(p => `      <li><span class="d">${p.date.slice(5)}</span><a href="../../${p.url}">${esc(p.title)}</a></li>`).join('\n');
    return `  <section class="arch-year"><h2>${y}<small>${years[y].length} 篇</small></h2><ul>\n${items}\n  </ul></section>`;
  }).join('\n');
  return T('archive.html')
    .replaceAll('{{COUNT}}', String(posts.length))
    .replaceAll('{{YEARS}}', blocks);
}

function renderTags(posts) {
  const tags = {};
  for (const p of posts) for (const t of p.tags) (tags[t] ||= []).push(p);
  const cards = Object.keys(tags).sort().map(t => {
    const items = tags[t].map(p => `<li><span class="d">${p.date}</span><a href="../../${p.url}">${esc(p.title)}</a></li>`).join('');
    return `<section class="tag-block" id="${esc(t)}"><h2>#${esc(t)}<small>${tags[t].length} 篇</small></h2><ul>${items}</ul></section>`;
  }).join('\n');
  return T('tags.html').replaceAll('{{TAGS}}', cards);
}

/* ------------------------------------------------------------------ build */
function build() {
  const t0 = Date.now();
  const posts = loadPosts();
  ARTICLE_TPL = T('post.html');

  fs.rmSync(PUBLIC, { recursive: true, force: true });
  ensure(PUBLIC);

  // 文章页
  posts.forEach((p, i) => {
    const dir = path.join(PUBLIC, p.url);
    ensure(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), renderPost(p, posts[i + 1], posts[i - 1]));
  });

  // 归档 / 标签
  ensure(path.join(PUBLIC, 'archives'));
  fs.writeFileSync(path.join(PUBLIC, 'archives', 'index.html'), renderArchive(posts));
  ensure(path.join(PUBLIC, 'tags'));
  fs.writeFileSync(path.join(PUBLIC, 'tags', 'index.html'), renderTags(posts));

  // 静态资源
  copyDir(path.join(THEME, 'assets'), path.join(PUBLIC, 'assets'));
  if (MEDIA) {
    // 图片已放对象存储，发布目录里只保留代码与数据
    for (const d of [path.join(PUBLIC, 'assets', 'img'), path.join(PUBLIC, 'images')]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
  copyDir(path.join(ROOT, 'static'), PUBLIC);   // 存档页 / 镜像树 / CNAME / .nojekyll
  if (!MEDIA) copyDir(path.join(SRC, 'images'), path.join(PUBLIC, 'images'));

  // 首页数据（Vue 首页读取）
  ensure(path.join(PUBLIC, 'assets', 'data'));
  const news = posts.slice(0, 14).map(p => ({
    slug: p.slug, title: p.title, date: p.date,
    url: '/' + p.url,
    cover: p.cover ? '/' + p.cover : '',
    excerpt: p.excerpt, tags: p.tags,
  }));
  fs.writeFileSync(path.join(PUBLIC, 'assets', 'data', 'news.json'), JSON.stringify(news, null, 1));

  const years = {};
  for (const p of posts) years[p.date.slice(0, 4)] = (years[p.date.slice(0, 4)] || 0) + 1;
  const site = {
    stats: { posts: posts.length, years: Object.keys(years).length, tags: new Set(posts.flatMap(p => p.tags)).size },
    latest: news,
    years: Object.keys(years).sort().reverse().map(y => ({ y, n: years[y] })),
  };
  fs.writeFileSync(path.join(PUBLIC, 'assets', 'data', 'site.json'), JSON.stringify(site, null, 1));

  // 首页
  fs.writeFileSync(path.join(PUBLIC, 'index.html'), read(path.join(THEME, 'templates', 'index.html')));

  if (MEDIA) rewriteMedia(PUBLIC, MEDIA);

  console.log(`✓ build ${posts.length} posts → public/  (${Date.now() - t0} ms)`);
}

/* ------------------------------------------------------------------ media rewrite */
/** 把页面里的本地图片引用替换成对象存储外链，仓库只留源码与页面 */
function rewriteMedia(dir, base) {
  const exts = new Set(['.html', '.css', '.js', '.json']);
  const patterns = [
    [/src="\/images\//g, `src="${base}/images/`],
    [/href="\/images\//g, `href="${base}/images/`],
    [/url\((['"]?)\/images\//g, `url($1${base}/images/`],
    [/src="\/assets\/img\//g, `src="${base}/assets/img/`],
    [/href="\/assets\/img\//g, `href="${base}/assets/img/`],
    [/url\((['"]?)\/assets\/img\//g, `url($1${base}/assets/img/`],
    [/"\/images\//g, `"${base}/images/`],
    [/'\/images\//g, `'${base}/images/`],
    [/"\/assets\/img\//g, `"${base}/assets/img/`],
    [/'\/assets\/img\//g, `'${base}/assets/img/`],
  ];
  let changed = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!exts.has(path.extname(e.name).toLowerCase())) continue;
      let txt = fs.readFileSync(full, 'utf8');
      const before = txt;
      for (const [re, rep] of patterns) txt = txt.replace(re, rep);
      if (txt !== before) { fs.writeFileSync(full, txt); changed++; }
    }
  })(dir);
  if (changed) console.log(`  media → ${base}  (${changed} files rewritten)`);
}

/* ------------------------------------------------------------------ serve / watch */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serve(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(PUBLIC, p);
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  server.listen(port, '127.0.0.1', () => console.log(`→ http://127.0.0.1:${port}/`));
}

build();
if (WATCH) {
  let timer = null;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(() => { try { build(); } catch (e) { console.error('build error:', e.message); } }, 120); };
  fs.watch(path.join(SRC, '_posts'), rebuild);
  fs.watch(path.join(THEME, 'templates'), rebuild);
  fs.watch(path.join(THEME, 'assets'), { recursive: true }, rebuild);
  console.log('watching source/_posts, theme/ …');
}
if (SERVE || WATCH) serve(PORT);
