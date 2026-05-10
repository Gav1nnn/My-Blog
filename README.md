# Gavin's Blog

一个基于 Astro 构建的个人技术博客，用来记录学习笔记、开发实践和项目过程。

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

| Command | Action |
| :--- | :--- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 执行类型检查并生成 `dist/` |
| `npm run preview` | 本地预览生产构建 |

## 写作入口

- 文章放在 `src/content/blog/`
- 页面入口在 `src/pages/`
- 站点信息集中在 `src/consts.ts`
- 项目卡片数据在 `src/data/projects.ts`

## 部署

当前部署目标是 `Cloudflare Workers Static Assets`。

首次上线前至少完成这几步：

1. 在 GitHub 创建你自己的仓库，并把本地仓库的 `origin` 改成新的仓库地址。
2. 复制 `.env.example` 为本地 `.env`，把 `SITE` 改成实际的 `workers.dev` 地址或自定义域名。
3. 把代码推到 GitHub，再让 Cloudflare 的 `Workers & Pages` 连接这个仓库。
4. 在 Cloudflare 中使用 `npm run build` 作为构建命令，`npm run deploy:cloudflare` 作为部署命令。
5. 在 Cloudflare 的生产环境变量里配置同样的 `SITE`。

详细步骤见 [docs/deploy-cloudflare-workers.md](docs/deploy-cloudflare-workers.md)。

## 上线前检查

- `npm run build` 必须通过
- 至少保留 1 篇正式文章，并补上 `description`、`seoTitle`、`tags`
- 检查首页、文章页、标签页、关于页能正常访问
- 确认 `SITE` 不再是 `localhost`
