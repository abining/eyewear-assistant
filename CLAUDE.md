# 镜选 / Eyewear Assistant

项目运行、模型坐标约定和部署方式见 README.md。

- 不运行类型检查，不格式化，不创建 worktree；仅在用户明确要求时提交和推送 Git。
- 当前负责人协调任务，同一文件同一时间只有一个写入者。
- `src/core/` 保持与 React 无关；界面位于 `src/components/` 和 `src/App.tsx`。
- 使用 `pnpm test` 检查行为，`pnpm build` 仅执行 Vite 打包。
- 浏览器验收使用参考人头或公开测试素材，不提交私人照片、原始视频、密钥或本机执行记录。
- 站点使用 Cloudflare Workers Static Assets；模型从 `public/models/` 分发。
- 本项目自有新增内容仅限非商业使用。保留 LICENSE、THIRD_PARTY_NOTICES.md、LICENSES/ 及构建后的第三方许可。
- 修改许可时同步 `public/license.txt` 和 `public/third-party-notices.txt`；构建会自动生成打包依赖的许可清单。
