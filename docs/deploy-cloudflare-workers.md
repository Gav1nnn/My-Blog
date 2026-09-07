# Cloudflare Workers 部署清单

当前博客使用 `GitHub 仓库 + Cloudflare Workers Static Assets`，正式域名为 `https://gavin.wiki`。
已有 Cloudflare 项目迁移到 pnpm 时，直接检查第 4、5 节的命令和构建变量即可。

## 1. 创建你自己的 GitHub 仓库

在 GitHub 新建一个空仓库，然后把本地项目的远程地址改成你自己的仓库：

```bash
git remote remove origin
git remote add origin https://github.com/<your-name>/<your-repo>.git
git push -u origin main
```

如果你的默认分支不是 `main`，把命令里的分支名换成实际分支。

## 2. 配置本地环境变量

复制一份 `.env.example`：

```bash
cp .env.example .env
```

至少要设置这个变量：

```bash
SITE='https://gavin.wiki'
```

说明：

- `SITE` 用于生成 canonical、sitemap、RSS 和 Open Graph URL
- 如果后面绑定了自定义域名，再把它改成正式域名
- `.env` 不要提交到仓库

本地使用 Node.js 24 和 pnpm 10.34.5，安装依赖时运行 `pnpm install --frozen-lockfile`。
Wrangler 已作为开发依赖固定在仓库内，不需要再通过 `npx` 临时下载。

## 3. 连接 Cloudflare

在 Cloudflare Dashboard 中：

1. 打开 `Workers & Pages`
2. 选择 `Create`
3. 点击 `Continue with GitHub`
4. 选择你刚创建的博客仓库

## 4. 设置构建与部署参数

当前项目用下面这组配置：

- Project name: `blog`
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Deploy command: `pnpm deploy:cloudflare`

仓库已经包含 `wrangler.jsonc`，它会把构建后的 `dist/` 作为静态资源上传到 Workers。

## 5. 配置生产环境变量

在 Cloudflare 项目的 `Settings -> Build -> Build Variables and Secrets` 中添加：

```text
NODE_VERSION = 24
PNPM_VERSION = 10.34.5
SKIP_DEPENDENCY_INSTALL = 1
SITE = https://gavin.wiki
```

`SKIP_DEPENDENCY_INSTALL=1` 关闭平台自动安装，由第 4 节的构建命令执行冻结锁文件安装，避免重复安装。
`PNPM_VERSION` 与 `package.json` 中的 `packageManager` 保持一致；后续升级 pnpm 时要同步更新。
这些设置依据 [Cloudflare 构建镜像说明](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

`SITE` 必须是**构建环境变量**：Astro 在构建时生成静态页面，仅配置 Worker 运行时变量不会修正已经生成的 URL。
本地 `.env` 不会自动上传到 Cloudflare。

如果你暂时不用统计、评论或 GitHub API，这几个变量可以先留空：

- `PUBLIC_GTAG_MEASUREMENT_ID`
- `GISCUS_REPO`
- `GISCUS_REPO_ID`
- `GISCUS_CATEGORY`
- `GISCUS_CATEGORY_ID`
- `GITHUB_PERSONAL_ACCESS_TOKEN`

## 6. 首次发布后验证

上线后至少检查这些地址：

- `/`
- `/about/`
- `/posts/`
- `/tags/`
- `/rss.xml`

再检查这几项：

- 页面源码里的 canonical 已经是 `workers.dev` 或你的正式域名
- sitemap 可以正常访问
- 主题切换刷新后仍然保持
- 标签页能打开
- 首篇文章能正常访问

## 7. 以后怎么更新

后续更新流程会很简单：

1. 本地写文章或改页面
2. 运行 `pnpm install --frozen-lockfile` 和 `pnpm build`
3. 提交并 push 到 GitHub
4. Cloudflare 自动重新部署
