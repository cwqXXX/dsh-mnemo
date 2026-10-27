# dsh-mnemo

给 DeepSeek Harness 的**跨会话长期记忆**。规则和坑每轮注入，其余按「词证据」召回；数据是明文 JSON，人能看、能改、能备份。

## 装

```sh
dsh plugin --profile <你的 profile> add dsh-mnemo
```

或在 **设置 → 插件 → 插件市场** 里搜索安装，然后重启宿主。

装好后在 **设置 → 鲸忆** 里管理。

## 它记住什么

| 层 | 内容 | 生命周期 |
|---|---|---|
| 全局 `global` | 硬规则、坑、偏好、环境事实 | 永久；规则每轮注入 |
| 项目 `project:<目录名>` | 某个工作区的固定事实 | 跨会话 |
| 会话 `session:<id>` | 只属于当前会话的结论 | 随会话 |

- **规则钉住**：`rule` / `pitfall` 或 `pinned` 的条目每轮注入，永不衰减
- **其余会淡忘**：fact 365 天、task 120 天、event 60 天的半衰期，但显式检索仍查得到
- **事实键**：`对象.方面` 同键只留最新，旧的标「已被取代」而不是删除

## 三个工具

| 工具 | 用途 |
|---|---|
| `memory_save` | 记一条：`kind`、`pinned`、`factKey`、`supersedes`、`scope` |
| `memory_recall` | 按关键词查；不给 query 就按重要度列最近的 |
| `memory_forget` | 软删除（文件里仍保留） |

## 数据

| 路径 | 内容 |
|---|---|
| `~/.dsh/mnemo/memory.json` | 真源，明文 JSON |
| `~/.dsh/mnemo/MEMORY.md` | 人读镜像（只读） |
| `~/.dsh/mnemo/mnemo.log` | 加载/错误日志 |

## 设计取舍

- **注入走 `systemPrompt.context`**（追加在对话末尾），不动系统提示词，**不破坏 prompt 缓存**
- **召回用 IDF 加权覆盖率**：专有词权重高、口水词权重低，宁可漏也不被常见词骗进来
- **只依赖 Node 内置模块**：不 import `@deepseek-ai/*`，不会因为 peer 依赖缺失整条插件不激活

## 许可

MIT
