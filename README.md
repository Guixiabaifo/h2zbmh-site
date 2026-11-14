# 杭州二中白马湖学校官网

静态站，**内容只需要管理 Markdown 文件**：写稿放进 `source/_posts/`，推送后 GitHub Actions 自动构建并发布。

## 目录结构

```
source/
  _posts/*.md        文章（YAML front matter + Markdown 正文）
  images/            文章图片
theme/
  templates/         页面模板（首页 / 文章 / 归档 / 标签）
  assets/            样式、脚本、图标、照片
scripts/build.mjs    构建脚本（生成 public/）
public/              构建产物（不提交）
```

## 写一篇新闻

```md
---
title: 标题
date: 2026-03-25 09:00:00
categories: [校园新闻]
tags: [校超, 体育]
cover: images/640-1-1.jpg
excerpt: 摘要（可选）
---

正文用 Markdown 写，图片：

![图片说明](images/640-2-1.jpg)
```

## 本地开发

```bash
npm install
npm run dev      # 构建 + 监听 source/_posts、theme/，自动重建
# 打开 http://127.0.0.1:8080/
```

其他命令：`npm run build`（只构建）、`npm run serve`（构建并起服务）、`npm run clean`。

## 发布

本地构建后推送到 `gh-pages` 分支，GitHub Pages 直接托管该分支：

```bash
npm run deploy          # 构建 + 强制推送 gh-pages
```

也可以手动：`npm run build`，然后把 `public/` 内容推到一个只有构建产物的分支。

> 仓库 Settings → Pages → Source 需设为 **Deploy from a branch → gh-pages / (root)**。

文章地址：`/年/月/日/文件名/`，例如 `/2026/03/25/20260325-03/`；归档 `/archives/`，标签 `/tags/`。
