# Cloudflare Workers 部署清单

这份文档对应当前仓库的推荐上线方式：`GitHub 仓库 + Cloudflare Workers Static Assets + workers.dev 域名`。

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
SITE='https://blog.<your-subdomain>.workers.dev'
```

说明：

- `SITE` 用于生成 canonical、sitemap、RSS 和 Open Graph URL
- 如果后面绑定了自定义域名，再把它改成正式域名
- `.env` 不要提交到仓库

## 3. 连接 Cloudflare

在 Cloudflare Dashboard 中：

1. 打开 `Workers & Pages`
2. 选择 `Create`
3. 点击 `Continue with GitHub`
4. 选择你刚创建的博客仓库

## 4. 设置构建与部署参数

当前项目用下面这组配置：

- Project name: `blog`
- Build command: `npm run build`
- Deploy command: `npm run deploy:cloudflare`

仓库已经包含 `wrangler.jsonc`，它会把构建后的 `dist/` 作为静态资源上传到 Workers。

## 5. 配置生产环境变量

在 Cloudflare 项目的 `Settings -> Variables and Secrets` 中添加：

```text
SITE = https://blog.<your-subdomain>.workers.dev
```

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
2. 运行 `npm run build`
3. 提交并 push 到 GitHub
4. Cloudflare 自动重新部署
