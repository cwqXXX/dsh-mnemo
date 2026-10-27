# 上架清单（P0：缺账号）

> 包名 `dsh-mnemo` 在 npm 上 **404 = 没人占**。
> 本地：git 仓库已 init、12 个文件已暂存，**还没 commit**（等你定作者身份）。

## 一、需要你做的两件事（约 5 分钟）

### 1. npm 账号

1. https://www.npmjs.com/signup 注册（邮箱验证）
2. 右上头像 → **Access Tokens** → **Generate New Token** → 选 **Automation**（跳过 2FA 弹窗）
3. 复制 `npm_...`

### 2. GitHub 账号 + 空仓库

1. https://github.com 注册（邮箱验证）
2. 新建仓库：名字 `dsh-mnemo`，**Public**，**不要**勾 README / .gitignore / license（要空仓库）
3. Settings → Developer settings → **Personal access tokens (classic)** → Generate new token
   - 勾 `repo`（够用：建仓库、push、fork、提 PR）
   - 复制 `ghp_...`

### 3. 把 token 放到文件里（别贴聊天）

```
C:\Users\XXX\.npmrc                   内容一行：//registry.npmjs.org/:_authToken=npm_xxx
C:\Users\XXX\.dsh\github-token.txt    内容一行：ghp_xxx
```

放好回一句「好了」，我读完文件（不回显）后接手：commit → push → publish → 提 PR。

## 二、我接手后会跑的命令

```bash
# 身份 + 提交
git config user.name  "<GitHub 用户名>"
git config user.email "<GitHub 邮箱>"
git commit -m "dsh-mnemo 0.2.0: cross-session memory for DeepSeek Harness"
git branch -M main
git remote add origin https://<user>:<token>@github.com/<user>/dsh-mnemo.git
git -c http.sslVerify=false push -u origin main

# 发 npm（private 已 false）
node pnpm.mjs publish --access public --no-git-checks

# 提 PR
# fork awesome-dsh-plugin → 在 README 的 Memory 分类加一行 → PR
```

> GitHub 走的是 Steam++，push 要 `-c http.sslVerify=false`，否则证书报错。

## 三、给 awesome-dsh-plugin 的条目

分类 `memory`（目录 index 里是 `"memory": {"en":"Memory","zh":"记忆"}`）：

```markdown
- [dsh-mnemo](https://github.com/<user>/dsh-mnemo) — 跨会话长期记忆：规则/坑每轮注入，其余按 IDF 证据召回；事实键去重、明文 JSON、设置页可增删改。`dsh plugin --profile web add dsh-mnemo`
```

标题（PR）：
`Add dsh-mnemo (memory)`，正文写清：做什么、怎么装、数据存哪、MIT。

## 四、如果不想发公开

市场条目必须有公开 GitHub 仓库，没有就走不了。替代方案：

- 本地 `link:`（现在就是）
- 或把 `pnpm pack` 出来的 `dsh-mnemo-0.2.0.tgz` 发给别人 `dsh plugin add <tgz 路径>`

## 五、发之前还差什么

- [x] `private: false`、`publishConfig.public`、`engines.dsh >=0.2.0`
- [x] README / LICENSE / icon / locale
- [x] `pnpm pack` 验证：9 个文件，含 client.js
- [x] 工具 schema 回归、33 项自检、14 项接口自检
- [ ] 页面刷新后目视确认「设置 → 鲸忆」
- [ ] npm 账号 + token
- [ ] GitHub 账号 + 空仓库 + token
