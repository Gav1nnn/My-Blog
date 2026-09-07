# Gavin's Blog

一个基于 Astro 构建的个人技术博客，用来记录学习笔记、开发实践和项目过程。

## 本地开发

推荐使用 Node.js 24（见 `.node-version`），包管理器固定为 pnpm 10.34.5。
首次安装 pnpm 可以运行 `npm install --global pnpm@10.34.5`；之后项目依赖统一用 pnpm 管理。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

如果本地还保留迁移前由 npm 安装的 `node_modules/`，先删除该目录，再执行上面的安装命令。
提交 `pnpm-lock.yaml`，不要再生成 `package-lock.json`。新增依赖用 `pnpm add <包名>`，开发依赖用 `pnpm add -D <包名>`。

常用命令：

| Command | Action |
| :--- | :--- |
| `pnpm dev` | 启动本地开发服务器 |
| `pnpm build` | 执行类型检查并生成 `dist/` |
| `pnpm preview` | 本地预览生产构建 |
| `pnpm preview:cloudflare` | 构建并在本地 Workers 环境中预览 |
| `pnpm deploy:cloudflare` | 使用仓库锁定的 Wrangler 发布已有 `dist/` |

`pnpm-workspace.yaml` 用于声明 esbuild、sharp 和 workerd 的安装脚本权限，本项目仍是单包应用。

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
4. 在 Cloudflare 中使用 `pnpm install --frozen-lockfile && pnpm build` 作为构建命令，`pnpm deploy:cloudflare` 作为部署命令。
5. 在 Cloudflare 的构建变量里配置 `NODE_VERSION=24`、`PNPM_VERSION=10.34.5`、`SKIP_DEPENDENCY_INSTALL=1` 和 `SITE=https://gavin.wiki`。

现有 Cloudflare 项目迁移时同样需要更新上述命令和构建变量；修改本地文件不会同步修改控制台设置。

详细步骤见 [docs/deploy-cloudflare-workers.md](docs/deploy-cloudflare-workers.md)。

## 上线前检查

- `pnpm install --frozen-lockfile` 和 `pnpm build` 必须通过
- 至少保留 1 篇正式文章，并补上 `description`、`seoTitle`、`tags`
- 检查首页、文章页、标签页、关于页能正常访问
- 确认 `SITE` 不再是 `localhost`
