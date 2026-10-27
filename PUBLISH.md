# 上架记录（2026-10-27）

## 已完成

| 项 | 状态 |
|---|---|
| npm 账号 | ✅ `cwq.xxx`，token 在 `~/.npmrc`（7 天，2026-11-03 过期；2FA 绕过型） |
| npm 发布 | ✅ **dsh-mnemo@0.2.0** → https://www.npmjs.com/package/dsh-mnemo（latest 已指向 0.2.0） |
| GitHub 账号 | ✅ `cwqXXX`（cwq147563@163.com） |
| GitHub 仓库 | ✅ https://github.com/cwqXXX/dsh-mnemo（public，main 分支，13 个文件，topic 已加 `dsh-plugin`） |
| GitHub token | ✅ 在 `~/.dsh/github-token.txt`（repo scope，30 天） |

> 注：`dsh.py push` 走 Steam++ 会卡在 `git-receive-pack`，最后是用 **GitHub REST API**（blobs → tree → commit → ref）建的首个提交。

## 卡住的一项：市场 PR 要等 1 天

`contributing.md` 明确要求：**仓库创建满 1 天**才会被 CI 接收。
仓库创建于 `2026-10-27T06:04:02Z`，**最早 2026-10-28T06:04Z（北京时间 10-28 14:04）** 之后才能提 PR。

## 明天要做（已备好脚本）

```bash
# 条目：work/mnemo-tests/submission-cwqXXX__dsh-mnemo.yml
# 脚本：work/mnemo-tests/submit-market.mjs（fork → 建分支 → 写 data/plugins/…yml → 开 PR）
GITHUB_TOKEN=$(cat ~/.dsh/github-token.txt) \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
node work/mnemo-tests/submit-market.mjs
```

PR 目标：`awesome-dsh-plugin/awesome-dsh-plugin`，文件 `data/plugins/cwqXXX__dsh-mnemo.yml`，分类 `memory`。
（README 是生成的，**不要**手工改 README。）

## 其它要求核对

- [x] `package.json` 有 `dsh.bundle.patch`（不是只有 `dsh.client`）
- [x] 仓库有真实代码（index.js 861 行 + client.js）
- [x] `dsh-plugin` topic
- [x] 描述英文以句号结尾、含 `: ` 时加引号（本条目已加单引号）
- [ ] 仓库满 1 天（明天）
- [ ] 市场 PR

## 注意

- npm token 7 天、GitHub token 30 天，过期后重新生成；`~/.npmrc` 和 `~/.dsh/github-token.txt` 用完可删。
- `dsh-mnemo` 下有个 `0.0.0-stage` 占位版本（npm staged publishing 的产物），已不影响 `latest`，可以不管。
