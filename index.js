// dsh-mnemo —— 给 DSH 的跨会话长期记忆
//
// 设计目标（来自 2026-10-27 的记忆插件调研）：
//   1. 全局层 + 项目层 + 会话层，三层都能用；规则/坑永不衰减，事件按半衰期淡忘
//   2. 召回按「词证据」算：IDF 加权 + 覆盖率，宁可漏也不被常见词骗进来
//   3. 事实键：同一个「对象.方面」只留最新一条，旧的标「已被取代」不删
//   4. 每轮注入放在 systemPrompt.context（不碰系统提示词，不毁缓存）
//   5. 数据是明文 JSON + 一份 MEMORY.md 镜像，人能看、能改、能备份
//
// 只依赖 node 内置模块：插件在任何环境下都能加载。

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  statSync, copyFileSync, appendFileSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------- 路径与常量

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = process.env.DSH_MNEMO_DIR || join(HOME, 'mnemo')
const FILE = join(DIR, 'memory.json')
const MD = join(DIR, 'MEMORY.md')
const LOG = join(DIR, 'mnemo.log')

const DAY = 86400000
const KINDS = ['rule', 'pitfall', 'pref', 'fact', 'task', 'event']
const KIND_LABEL = {
  rule: '规则', pitfall: '坑', pref: '偏好', fact: '事实', task: '任务', event: '事件',
}
const HALF_LIFE_DAYS = {
  rule: Infinity, pitfall: Infinity, pref: Infinity,
  fact: 365, task: 120, event: 60,
}
const DEFAULT_IMPORTANCE = {
  rule: 0.9, pitfall: 0.85, pref: 0.75, fact: 0.6, task: 0.6, event: 0.5,
}

let ctxRef = null

// ---------------------------------------------------------------- 小工具

function diag(msg) {
  try {
    mkdirSync(DIR, { recursive: true })
    const line = new Date().toISOString() + '  ' + String(msg) + '\n'
    appendFileSync(LOG, line, 'utf8')
    if (existsSync(LOG) && statSync(LOG).size > 1024 * 1024) {
      writeFileSync(LOG, line, 'utf8')
    }
  } catch { /* 日志坏了也不影响记忆 */ }
}

function clamp(n, lo, hi) {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : lo
  return Math.max(lo, Math.min(hi, x))
}

function nowIso() { return new Date().toISOString() }

function dayOf(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toISOString().slice(0, 10)
}

function newId() {
  return 'm_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 6)
}

// ---------------------------------------------------------------- 存储

function ensureDir() {
  try { mkdirSync(DIR, { recursive: true }) } catch { /* ignore */ }
}

function blank() {
  return { version: 1, createdAt: nowIso(), updatedAt: nowIso(), entries: [] }
}

/** 第一次安装时的「底子」：把已经踩过的坑先写进去，插件装上就有用。 */
function seed() {
  const st = blank()
  const add = (text, kind, extra) => {
    st.entries.push({
      id: newId(),
      text,
      kind,
      scope: 'global',
      tags: [],
      importance: DEFAULT_IMPORTANCE[kind] ?? 0.5,
      pinned: kind === 'rule' || kind === 'pitfall',
      factKey: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      useCount: 0,
      lastUsedAt: null,
      supersededBy: null,
      deletedAt: null,
      source: 'seed',
      ...extra,
    })
  }
  add('改 package.json / JSON 绝不能用带 BOM 的 UTF-8（DSH 会启动崩）；PowerShell 写文件用 UTF8Encoding($false)。.ps1 里写中文路径要存 UTF-8 带 BOM，否则按 GBK 解码。', 'pitfall')
  add('时间一律用绝对时间（如 2026-10-23 10:17），不说「今晚/昨天/三天前」。', 'rule')
  add('这个 agent 控制不了 DSH 自己的窗口：focus 会被拒，键鼠会穿透到后面窗口。要改会话名让用户按 Ctrl+Alt+G。', 'pitfall')
  add('DSH 会话日志是多帧 zstd，不能直接解压；用 工具/dshtypes.js 按 magic 28 b5 2f fd 拆帧。', 'pitfall')
  add('Steam++ 开着时 curl 报 TLS 错是正常的（自签证书本地反代），加 -k 或改用 Invoke-RestMethod；关掉后注意 hosts 里 127.0.0.1 残留。', 'pitfall')
  add('浏览器页面异常先 F12 看控制台：找红字、ERR_BLOCKED_BY_CLIENT、失败请求，再猜。', 'rule')
  add('用户偏好：中文回答；先结论后细节；不要客套和总结废话；不确定就说不确定，别编。', 'pref', { importance: 0.8 })
  add('工作区在 C:\\Users\\XXX\\Documents\\deepseek-harness\\default-workspace：INDEX.md 是全量索引，交接.md 是环境现状，notes/ 是长笔记。', 'fact', { importance: 0.8 })
  return st
}

let cache = { mtime: -1, data: null }

function normalize(st) {
  if (!st || typeof st !== 'object') return blank()
  if (!Array.isArray(st.entries)) st.entries = []
  st.version = st.version || 1
  st.createdAt = st.createdAt || nowIso()
  st.updatedAt = st.updatedAt || nowIso()
  const seen = new Set()
  st.entries = st.entries.filter((e) => {
    if (!e || typeof e.text !== 'string' || !e.text.trim()) return false
    if (e.id && seen.has(e.id)) return false
    if (e.id) seen.add(e.id)
    else e.id = newId()
    if (!KINDS.includes(e.kind)) e.kind = 'fact'
    if (!e.scope || typeof e.scope !== 'string') e.scope = 'global'
    if (!Array.isArray(e.tags)) e.tags = []
    e.importance = clamp(e.importance, 0, 1)
    if (e.importance === 0) e.importance = DEFAULT_IMPORTANCE[e.kind] ?? 0.5
    e.pinned = Boolean(e.pinned)
    e.useCount = typeof e.useCount === 'number' ? e.useCount : 0
    e.createdAt = e.createdAt || nowIso()
    e.updatedAt = e.updatedAt || e.createdAt
    e.supersededBy = e.supersededBy || null
    e.deletedAt = e.deletedAt || null
    return true
  })
  return st
}

function load() {
  ensureDir()
  if (!existsSync(FILE)) {
    const st = seed()
    save(st)
    return st
  }
  let m = 0
  try { m = statSync(FILE).mtimeMs } catch { m = 0 }
  if (cache.data && cache.mtime === m) return cache.data
  try {
    const data = normalize(JSON.parse(readFileSync(FILE, 'utf8')))
    cache = { mtime: m, data }
    return data
  } catch (error) {
    diag('memory.json 读不出来，先用空库：' + (error && error.message))
    const data = blank()
    cache = { mtime: m, data }
    return data
  }
}

let backedUp = false

function save(st) {
  ensureDir()
  st.updatedAt = nowIso()
  try {
    if (!backedUp && existsSync(FILE)) {
      copyFileSync(FILE, FILE + '.bak')
      backedUp = true
    }
  } catch { /* ignore */ }
  const tmp = FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8')
  renameSync(tmp, FILE)
  cache = { mtime: -1, data: null }
  try { exportMd(st) } catch (error) { diag('写 MEMORY.md 失败：' + (error && error.message)) }
}

function exportMd(st) {
  const live = st.entries.filter((e) => !e.deletedAt && !e.supersededBy)
  const rules = live.filter((e) => e.pinned || KINDS.indexOf(e.kind) <= 1)
  const rest = live.filter((e) => !(e.pinned || KINDS.indexOf(e.kind) <= 1))
  const line = (e) => {
    const d = dayOf(e.updatedAt || e.createdAt)
    const tag = e.pinned ? ' 📌' : ''
    return `- [${KIND_LABEL[e.kind] || e.kind}] ${e.text}${d ? `（${d}）` : ''}${tag}  \`${e.id}\``
  }
  const out = [
    '# 长期记忆（dsh-mnemo 自动生成）',
    '',
    '> 这是镜像，改动不会回写。要改请用 memory_save / memory_forget 工具，',
    '> 或直接编辑同目录的 memory.json（插件会按 mtime 重新加载）。',
    '',
    `更新时间：${st.updatedAt}`,
    '',
    '## 规则 / 坑（每轮注入）',
    '',
    ...(rules.length ? rules.map(line) : ['（空）']),
    '',
    '## 偏好 / 事实 / 任务 / 事件（按需召回）',
    '',
    ...(rest.length ? rest.map(line) : ['（空）']),
    '',
  ]
  writeFileSync(MD, out.join('\n'), 'utf8')
}

// ---------------------------------------------------------------- 分词与打分

const CJK = /[\u3400-\u9fff\uf900-\ufaff]+/g
const LATIN = /[a-z0-9_]{2,}/g
const BIGRAM_STOP = new Set([
  '可以', '这个', '那个', '什么', '怎么', '我们', '你们', '他们', '一个', '就是',
  '不是', '没有', '还是', '因为', '所以', '如果', '现在', '已经', '之后', '之前',
  '时候', '问题', '事情', '东西', '自己', '一下', '知道', '觉得', '应该', '需要',
  '这里', '那里', '然后', '但是', '而且', '或者', '以及', '进行', '由于', '对于',
])

function tokensOfText(text) {
  const out = new Set()
  const s = String(text || '').toLowerCase()
  for (const w of s.match(LATIN) || []) out.add(w)
  for (const run of s.match(CJK) || []) {
    if (run.length === 1) { out.add(run); continue }
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2)
      if (!BIGRAM_STOP.has(bg)) out.add(bg)
    }
    if (run.length <= 4) out.add(run)
  }
  return out
}

const tokenCache = new Map()
function entryTokens(e) {
  const key = e.id + '|' + e.updatedAt + '|' + (e.text.length)
  let t = tokenCache.get(key)
  if (!t) {
    t = tokensOfText(e.text + ' ' + (e.tags || []).join(' '))
    tokenCache.set(key, t)
    if (tokenCache.size > 2000) tokenCache.clear()
  }
  return t
}

function decayFactor(e, now) {
  const half = HALF_LIFE_DAYS[e.kind]
  if (!Number.isFinite(half)) return 1
  const t = Date.parse(e.updatedAt || e.createdAt) || now
  const days = Math.max(0, (now - t) / DAY)
  return Math.pow(0.5, days / half)
}

/**
 * @param minScore 注入用 0.1（宁可漏）；显式检索用 0.0001（旧事按日期淡忘，但要查得到）
 * 返回 [{entry, score, hit}]，按分数降序。query 为空则按「重要 + 新」排。
 */
function rank(entries, query, now, minScore = 0.1) {
  const q = tokensOfText(query)
  if (!q.size) {
    return entries
      .map((e) => ({ entry: e, score: 0.3 + 0.7 * (e.importance || 0.5) * decayFactor(e, now) }))
      .sort((a, b) => b.score - a.score)
  }
  const docs = entries.map((e) => ({ e, t: entryTokens(e) }))
  const n = Math.max(1, docs.length)
  const df = new Map()
  for (const d of docs) for (const tok of q) if (d.t.has(tok)) df.set(tok, (df.get(tok) || 0) + 1)
  const weight = new Map()
  let total = 0
  for (const tok of q) {
    const w = Math.log(1 + n / (1 + (df.get(tok) || 0)))
    weight.set(tok, w)
    total += w
  }
  if (!total) return []
  const out = []
  for (const d of docs) {
    let hit = 0
    let matched = 0
    for (const tok of q) {
      if (d.t.has(tok)) { hit += weight.get(tok); matched++ }
    }
    if (!hit) continue
    const coverage = hit / total
    const imp = 0.4 + 0.6 * (d.e.importance || 0.5)
    const score = coverage * imp * decayFactor(d.e, now) + (d.e.pinned ? 0.15 : 0)
    if (score < minScore) continue
    out.push({ entry: d.e, score, hit: matched })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// ---------------------------------------------------------------- 范围

function agentId(agent) {
  try {
    if (!agent) return ''
    return String(agent.id || (agent.session && agent.session.id) || '')
  } catch { return '' }
}

function projectDirOf(agent) {
  try {
    const wd = ctxRef && ctxRef.get('workingDirectory')
    if (wd && agent && agent.session) return String(wd.get(agent.session) || '')
  } catch { /* ignore */ }
  try {
    const h = agent && agent.session && agent.session.header
    if (h && h.cwd) return String(h.cwd)
  } catch { /* ignore */ }
  return ''
}

function projectScopeOf(agent) {
  const dir = projectDirOf(agent)
  return dir ? 'project:' + basename(dir) : ''
}

function inScope(e, agent) {
  if (!e.scope || e.scope === 'global') return true
  if (e.scope.startsWith('project:')) return e.scope === projectScopeOf(agent)
  if (e.scope.startsWith('session:')) return e.scope === 'session:' + agentId(agent)
  return true
}

function liveEntries(st, agent) {
  return st.entries.filter((e) =>
    !e.deletedAt && !e.supersededBy && inScope(e, agent))
}

/** 硬规则：钉住的、或 kind 是 rule/pitfall。这类只走【必须遵守】区。 */
function isRuleish(e) {
  return Boolean(e.pinned) || e.kind === 'rule' || e.kind === 'pitfall'
}

// ---------------------------------------------------------------- 注入

function textOfMessage(msg) {
  if (!msg) return ''
  if (typeof msg === 'string') return msg
  const c = msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n')
  }
  return ''
}

function lastUserTextOfSession(agent) {
  try {
    const s = agent && agent.session
    const evs = (s && typeof s.snapshotEvents === 'function' ? s.snapshotEvents() : []) || []
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i]
      if (ev && ev.type === 'user/message') {
        const t = textOfMessage(ev.data && ev.data.message)
        if (t) return t
      }
    }
  } catch { /* ignore */ }
  return ''
}

function injectOrder() { return 900 }

function buildContext(agent, lastText) {
  try {
    const st = load()
    const all = liveEntries(st, agent)
    if (!all.length) return ''
    const now = Date.now()

    const ruleList = all
      .filter(isRuleish)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 10)
    const ruleIds = new Set(ruleList.map((e) => e.id))
    // 规则只在【必须遵守】里出现；没挤进前 10 条的规则也不降级成「可能相关」
    const pool = all.filter((e) => !ruleIds.has(e.id) && !isRuleish(e))

    const query = String(lastText || lastUserTextOfSession(agent) || '').trim()
    const ranked = rank(pool, query, now)
    const picked = []
    let budget = 1100
    for (const r of ranked) {
      const len = r.entry.text.length
      if (len > budget) continue
      picked.push(r.entry)
      budget -= len
      if (picked.length >= 6) break
    }

    if (!ruleList.length && !picked.length) return ''
    const lines = []
    let ruleBudget = 1600
    const ruleLines = []
    for (const e of ruleList) {
      if (e.text.length > ruleBudget) continue
      ruleBudget -= e.text.length
      ruleLines.push('- ' + e.text)
    }
    if (ruleLines.length) {
      lines.push('【必须遵守 / 别再踩】')
      lines.push(...ruleLines)
    }
    if (picked.length) {
      if (lines.length) lines.push('')
      lines.push('【可能相关】')
      for (const e of picked) {
        const d = dayOf(e.updatedAt || e.createdAt)
        const label = KIND_LABEL[e.kind] || e.kind
        lines.push(`- [${label}${d ? ' ' + d : ''}] ${e.text}`)
      }
    }
    if (!lines.length) return ''
    return [
      '【长期记忆】以下是跨会话记下的事，按相关度挑出来的。用得上就用，别硬套；和当前事实冲突时以现在为准。',
      '',
      ...lines,
    ].join('\n')
  } catch (error) {
    diag('注入失败：' + (error && error.message))
    return ''
  }
}

// ---------------------------------------------------------------- 工具

const HINT = [
  '【记忆】遇到会跨会话复用的信息——用户的稳定偏好/约定/红线、项目的固定事实、踩过的坑、被纠正过的地方——',
  '用 memory_save 记一条，一句话一件事，带 kind。日常琐事、一次性进度、能从工作区文件查到的东西不要记。',
  '记之前先 memory_recall 查重；同一件事的新版本用 factKey 或 supersedes，别并排堆两条。',
  '长文档仍然写 notes/，这里只放一句话级的索引和结论。',
].join('')

// DSH 的 tools.register() 只收已经编译好的 JSON Schema，不会像 defineTool() 那样
// 把「属性表 + required: true」编译成 { type: 'object', ... }。插件为了保持零依赖
// 不 import defineTool，所以这里自己编译；否则整条请求会被 API 以
// "schema must be a JSON Schema of 'type': 'object', got 'type': null" 拒绝。
function parameterSchema(properties) {
  const required = []
  const compiled = {}
  for (const [key, spec] of Object.entries(properties)) {
    const { required: isRequired, ...rest } = spec
    compiled[key] = rest
    if (isRequired === true) required.push(key)
  }
  return {
    type: 'object',
    properties: compiled,
    ...(required.length ? { required } : {}),
  }
}

function makeSaveTool() {
  return {
    name: 'memory_save',
    description:
      '把一条值得跨会话记住的事写进长期记忆。只在真的会复用时调用：稳定偏好、约定、红线、项目固定事实、踩过的坑、被纠正的地方。' +
      '日常琐事、一次性的进度、能从工作区文件直接查到的东西不要记。记前先 memory_recall 查重，已有的不要重复记；同一件事变了用 factKey 或 supersedes。',
    parameters: parameterSchema({
      text: {
        type: 'string',
        required: true,
        description: '一句话说清，自带结论和条件。不要写「今天/昨天」，时间由系统记。',
      },
      kind: {
        type: 'string',
        enum: KINDS,
        description: 'rule=必须遵守 / pitfall=踩过的坑 / pref=偏好 / fact=事实 / task=待办 / event=发生过的事。默认 fact。',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '几个关键词，方便召回，比如 ["插件","安装"]。',
      },
      importance: {
        type: 'number',
        description: '0~1。0.5=一般，0.8=重要，1=红线。不确定就留空。',
      },
      pinned: {
        type: 'boolean',
        description: 'true = 每轮都注入（只给真正的硬规则/红线用，别滥用，会吃上下文）。',
      },
      factKey: {
        type: 'string',
        description: '可选。「对象.方面」，如 `用户.时区`、`项目.端口`。同键只留最新，旧的标「已被取代」。键里不要写具体值，也别用万能键。',
      },
      supersedes: {
        type: 'string',
        description: '可选。这条是在更新哪条旧记忆：填旧条的 id 或原文片段。',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'session'],
        description: 'global=所有会话（默认），project=当前工作区，session=只在当前会话。',
      },
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          action: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        if (!value || value.ok === false) {
          return [{ type: 'text', text: '✗ ' + String((value && value.message) || '没记上') }]
        }
        return [{ type: 'text', text: '✓ ' + String(value.message || '已记') }]
      },
    },
    async execute(args, exec) {
      try {
        const agent = exec && exec.agent
        const text = String((args && args.text) || '').trim()
        if (!text) return { ok: false, message: '内容是空的' }
        if (text.length > 600) return { ok: false, message: '太长了，一条只装一件事（600 字以内）' }

        let kind = String((args && args.kind) || 'fact')
        if (KINDS.indexOf(kind) < 0) kind = 'fact'
        const st = load()
        const now = nowIso()
        const scopeArg = String((args && args.scope) || 'global')
        const scope = scopeArg === 'project'
          ? (projectScopeOf(agent) || 'global')
          : scopeArg === 'session'
            ? ('session:' + agentId(agent))
            : 'global'
        const norm = (s) => String(s || '').toLowerCase().replace(/[\s，。、！？,.!?：:；;“”"'（）()【】\[\]]/g, '')

        // 1) supersedes：点名更新某条
        const sup = String((args && args.supersedes) || '').trim()
        let replaced = null
        if (sup) {
          const sn = norm(sup)
          replaced = st.entries.find((e) => !e.deletedAt && !e.supersededBy &&
            (e.id === sup || norm(e.text) === sn || (sn.length >= 6 && norm(e.text).includes(sn))))
        }

        // 2) 近重复：同一条又提了一次 → 强化
        const nt = norm(text)
        const dup = st.entries.find((e) => !e.deletedAt && !e.supersededBy && e.scope === scope &&
          (norm(e.text) === nt || (nt.length >= 10 && norm(e.text).length >= 10 &&
            (norm(e.text).includes(nt) || nt.includes(norm(e.text))))))
        if (dup && !replaced) {
          dup.useCount = (dup.useCount || 0) + 1
          dup.updatedAt = now
          dup.importance = Math.max(dup.importance || 0, clamp(args && args.importance, 0, 1) || 0)
          if (args && args.pinned === true) dup.pinned = true
          if (args && Array.isArray(args.tags) && args.tags.length) {
            dup.tags = Array.from(new Set([...(dup.tags || []), ...args.tags.filter((x) => typeof x === 'string')])).slice(0, 12)
          }
          save(st)
          return { ok: true, id: dup.id, action: 'reinforced', message: '这条已经记过了，强化了一次' }
        }

        const entry = {
          id: newId(),
          text,
          kind,
          scope,
          tags: Array.isArray(args && args.tags)
            ? args.tags.filter((x) => typeof x === 'string' && x.trim()).slice(0, 12)
            : [],
          importance: clamp(args && args.importance, 0, 1) || DEFAULT_IMPORTANCE[kind] || 0.5,
          pinned: args && args.pinned === true,
          factKey: (args && args.factKey) ? String(args.factKey).trim() : null,
          createdAt: now,
          updatedAt: now,
          useCount: 0,
          lastUsedAt: null,
          supersededBy: null,
          deletedAt: null,
          source: 'tool',
        }

        // 3) 事实键：同键只留最新
        if (entry.factKey) {
          const key = entry.factKey.toLowerCase()
          for (const e of st.entries) {
            if (e.deletedAt || e.supersededBy || !e.factKey) continue
            if (e.scope !== entry.scope) continue
            if (e.factKey.toLowerCase() === key) {
              e.supersededBy = entry.id
              e.updatedAt = now
            }
          }
        }

        // 4) 显式取代
        if (replaced) {
          replaced.supersededBy = entry.id
          replaced.updatedAt = now
        }

        st.entries.push(entry)
        save(st)
        return {
          ok: true,
          id: entry.id,
          action: replaced ? 'superseded' : 'created',
          message: replaced ? '已记，并取代了旧的那条' : '已记',
        }
      } catch (error) {
        diag('memory_save 出错：' + (error && error.message))
        return { ok: false, message: '写入失败：' + (error && error.message) }
      }
    },
  }
}

function makeRecallTool() {
  return {
    name: 'memory_recall',
    description:
      '从长期记忆里按关键词找相关条目；不给 query 就按重要度列最近的。查重、回忆旧约定、找之前记下的坑时用。返回 id，可交给 memory_forget。',
    parameters: parameterSchema({
      query: { type: 'string', description: '要找什么，用自然语言或关键词。' },
      kind: { type: 'string', enum: KINDS, description: '只看某一类。' },
      scope: { type: 'string', enum: ['all', 'global', 'project', 'session'], description: '默认 all。' },
      limit: { type: 'number', description: '最多几条，默认 8，上限 30。' },
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                kind: { type: 'string' },
                scope: { type: 'string' },
                text: { type: 'string' },
                updatedAt: { type: 'string' },
              },
            },
          },
        },
      },
      render(_args, value) {
        const items = (value && value.items) || []
        if (!items.length) return [{ type: 'text', text: '（没有找到相关记忆）' }]
        return [{
          type: 'text',
          text: items.map((i) => `- ${i.id} [${KIND_LABEL[i.kind] || i.kind}] ${i.text}`).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      try {
        const agent = exec && exec.agent
        const st = load()
        const limit = Math.max(1, Math.min(30, Number((args && args.limit) || 8)))
        const kind = args && args.kind
        const scopeArg = String((args && args.scope) || 'all')
        let pool = liveEntries(st, agent)
        if (kind && KINDS.indexOf(kind) >= 0) pool = pool.filter((e) => e.kind === kind)
        if (scopeArg === 'global') pool = pool.filter((e) => e.scope === 'global')
        if (scopeArg === 'project') pool = pool.filter((e) => e.scope === projectScopeOf(agent))
        if (scopeArg === 'session') pool = pool.filter((e) => e.scope === 'session:' + agentId(agent))
        const ranked = rank(pool, String((args && args.query) || ''), Date.now(), 0.0001).slice(0, limit)
        const items = ranked.map((r) => ({
          id: r.entry.id,
          kind: r.entry.kind,
          scope: r.entry.scope,
          text: r.entry.text,
          updatedAt: r.entry.updatedAt || r.entry.createdAt,
        }))
        for (const it of items) {
          const e = st.entries.find((x) => x.id === it.id)
          if (e) { e.useCount = (e.useCount || 0) + 1; e.lastUsedAt = nowIso() }
        }
        return { count: items.length, items }
      } catch (error) {
        diag('memory_recall 出错：' + (error && error.message))
        return { count: 0, items: [] }
      }
    },
  }
}

function makeForgetTool() {
  return {
    name: 'memory_forget',
    description:
      '软删除一条记错或过期的记忆（文件里仍保留，可人工找回）。优先用 id；也可以给 query 匹配最像的一条。',
    parameters: parameterSchema({
      id: { type: 'string', description: '要删的记忆 id（memory_recall 返回的）。' },
      query: { type: 'string', description: '或者给一段原文/关键词，删最匹配的那条。' },
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          count: { type: 'integer' },
          ids: { type: 'array', items: { type: 'string' } },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        if (!value || !value.ok) return [{ type: 'text', text: '✗ ' + String((value && value.message) || '没删掉') }]
        return [{ type: 'text', text: '✓ 删了 ' + value.count + ' 条' }]
      },
    },
    async execute(args, exec) {
      try {
        const agent = exec && exec.agent
        const st = load()
        const id = String((args && args.id) || '').trim()
        const query = String((args && args.query) || '').trim()
        const now = nowIso()
        const ids = []
        if (id) {
          const e = st.entries.find((x) => x.id === id && !x.deletedAt)
          if (e) { e.deletedAt = now; ids.push(e.id) }
        } else if (query) {
          const pool = liveEntries(st, agent)
          const best = rank(pool, query, Date.now())[0]
          if (best) { best.entry.deletedAt = now; ids.push(best.entry.id) }
        }
        if (!ids.length) return { ok: false, count: 0, ids: [], message: '没找到要删的那条' }
        save(st)
        return { ok: true, count: ids.length, ids, message: '已软删除' }
      } catch (error) {
        diag('memory_forget 出错：' + (error && error.message))
        return { ok: false, count: 0, ids: [], message: String(error && error.message) }
      }
    },
  }
}

// ---------------------------------------------------------------- 管理接口（设置页用）

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        try { req.destroy() } catch { /* ignore */ }
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

function normText(s) {
  return String(s || '').toLowerCase().replace(/[\s，。、！？,.!?：:；;“”"'（）()【】\[\]]/g, '')
}

function publicEntry(e) {
  return {
    id: e.id,
    text: e.text,
    kind: e.kind,
    scope: e.scope,
    tags: e.tags || [],
    importance: e.importance,
    pinned: Boolean(e.pinned),
    factKey: e.factKey || null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    useCount: e.useCount || 0,
    lastUsedAt: e.lastUsedAt || null,
    deletedAt: e.deletedAt || null,
    supersededBy: e.supersededBy || null,
  }
}

function apiStats(st) {
  const live = st.entries.filter((e) => !e.deletedAt && !e.supersededBy)
  return {
    total: st.entries.length,
    live: live.length,
    rules: live.filter(isRuleish).length,
    deleted: st.entries.filter((e) => e.deletedAt).length,
    superseded: st.entries.filter((e) => e.supersededBy).length,
  }
}

function registerAdminApi(ctx) {
  const route = (path, handler) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      const send = (code, payload) => {
        try {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(payload))
        } catch { /* 连接已断 */ }
      }
      try {
        const body = req.method === 'GET' ? {} : await readJsonBody(req)
        const result = await handler(req, body)
        send(200, result)
      } catch (error) {
        diag('管理接口出错 ' + path + '：' + (error && error.message))
        send(400, { ok: false, error: String((error && error.message) || '请求失败') })
      }
    },
  }))

  route('/dsh-mnemo/api/list', async () => {
    const st = load()
    return { ok: true, stats: apiStats(st), entries: st.entries.map(publicEntry) }
  })

  route('/dsh-mnemo/api/create', async (_req, body) => {
    const text = String(body.text || '').trim()
    if (!text) throw new Error('内容不能为空')
    if (text.length > 600) throw new Error('一条最多 600 字')
    const kind = KINDS.indexOf(body.kind) >= 0 ? body.kind : 'fact'
    const st = load()
    const now = nowIso()
    const nt = normText(text)
    const dup = st.entries.find((e) => !e.deletedAt && !e.supersededBy && e.scope === 'global' && normText(e.text) === nt)
    if (dup) {
      dup.useCount = (dup.useCount || 0) + 1
      dup.updatedAt = now
      save(st)
      return { ok: true, entry: publicEntry(dup), reinforced: true, stats: apiStats(st) }
    }
    const entry = {
      id: newId(),
      text,
      kind,
      scope: 'global',
      tags: [],
      importance: typeof body.importance === 'number' ? clamp(body.importance, 0, 1) : (DEFAULT_IMPORTANCE[kind] || 0.5),
      pinned: body.pinned === true,
      factKey: null,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      lastUsedAt: null,
      supersededBy: null,
      deletedAt: null,
      source: 'ui',
    }
    st.entries.push(entry)
    save(st)
    return { ok: true, entry: publicEntry(entry), stats: apiStats(st) }
  })

  route('/dsh-mnemo/api/update', async (_req, body) => {
    const st = load()
    const e = st.entries.find((x) => x.id === body.id)
    if (!e) throw new Error('找不到这条记忆')
    const now = nowIso()
    if (typeof body.text === 'string') {
      const t = body.text.trim()
      if (!t) throw new Error('内容不能为空')
      if (t.length > 600) throw new Error('一条最多 600 字')
      e.text = t
    }
    if (typeof body.pinned === 'boolean') e.pinned = body.pinned
    if (typeof body.importance === 'number') e.importance = clamp(body.importance, 0, 1)
    if (typeof body.deleted === 'boolean') e.deletedAt = body.deleted ? (e.deletedAt || now) : null
    e.updatedAt = now
    save(st)
    return { ok: true, entry: publicEntry(e), stats: apiStats(st) }
  })

  route('/dsh-mnemo/api/delete', async (_req, body) => {
    const st = load()
    const e = st.entries.find((x) => x.id === body.id)
    if (!e) throw new Error('找不到这条记忆')
    e.deletedAt = nowIso()
    e.updatedAt = e.deletedAt
    save(st)
    return { ok: true, stats: apiStats(st) }
  })

  route('/dsh-mnemo/api/purge', async (_req, body) => {
    const st = load()
    const before = st.entries.length
    st.entries = st.entries.filter((e) => !(e.id === body.id && e.deletedAt))
    if (st.entries.length === before) throw new Error('只能彻底删除已删除的条目')
    save(st)
    return { ok: true, stats: apiStats(st) }
  })
}

// ---------------------------------------------------------------- 插件生命周期

export const name = 'mnemo'
export const inject = ['systemPrompt', 'tools', 'agents', 'timer', 'webServer']

export function apply(ctx) {
  ctxRef = ctx
  const mounted = new Map()

  function mount(agent) {
    if (!agent || !agent.ctx) return
    if (mounted.has(agent)) return
    let lastText = ''
    let off
    try {
      off = agent.ctx.effect(() => {
        const disposers = []
        const add = (fn) => { try { const d = fn(); if (typeof d === 'function') disposers.push(d) } catch (error) { diag('挂载失败：' + (error && error.message)) } }

        // 启动自检：register() 只收编译好的 JSON Schema。若哪天改回「属性表」写法，
        // 宁可这个插件不激活，也不要让每个请求都因为 parameters.type=null 而 400。
        const toolDefs = [makeSaveTool(), makeRecallTool(), makeForgetTool()]
        const badTools = toolDefs.filter((t) =>
          !t || !t.parameters || t.parameters.type !== 'object' || !t.parameters.properties)
        if (badTools.length) {
          diag('FATAL 工具 schema 非法（缺 type:object/properties），已跳过注册：' +
            badTools.map((t) => (t && t.name) || '?').join(', '))
        } else {
          add(() => agent.ctx.tools.register(toolDefs[0]))
          add(() => agent.ctx.tools.register(toolDefs[1]))
          add(() => agent.ctx.tools.register(toolDefs[2]))
        }

        add(() => agent.ctx.systemPrompt.section({
          name: 'mnemo-hint',
          order: 89990,
          text: HINT,
        }))

        add(() => agent.ctx.systemPrompt.context({
          name: 'mnemo',
          order: injectOrder(),
          text: () => buildContext(agent, lastText),
        }))

        add(() => agent.ctx.on('agent/inbox/inserted', (payload) => {
          try {
            const msg = payload && payload.message ? payload.message : payload
            const t = textOfMessage(msg)
            if (t) lastText = t
          } catch { /* ignore */ }
        }))

        return () => {
          for (const d of disposers) {
            try { d() } catch { /* ignore */ }
          }
        }
      })
    } catch (error) {
      diag('agent 挂载失败：' + (error && error.message))
      return
    }
    mounted.set(agent, off)
  }

  function unmount(agent) {
    const off = mounted.get(agent)
    if (!off) return
    mounted.delete(agent)
    try { if (typeof off === 'function') off() } catch { /* ignore */ }
  }

  function tick() {
    try {
      const list = ctx.agents.list() || []
      for (const a of list) mount(a)
      for (const a of Array.from(mounted.keys())) {
        if (list.indexOf(a) < 0) unmount(a)
      }
    } catch (error) {
      diag('tick 失败：' + (error && error.message))
    }
  }

  try {
    ctx.on('agent/created', (payload) => { mount(payload && payload.agent) })
    ctx.on('agent/disposed', (payload) => { unmount(payload && payload.agent) })
  } catch (error) {
    diag('生命周期监听挂不上：' + (error && error.message))
  }

  tick()
  try {
    ctx.effect(() => ctx.interval(tick, 5000))
  } catch (error) {
    diag('定时器不可用：' + (error && error.message))
  }

  ctx.effect(() => () => {
    for (const off of mounted.values()) {
      try { if (typeof off === 'function') off() } catch { /* ignore */ }
    }
    mounted.clear()
  })

  try {
    registerAdminApi(ctx)
    diag('管理接口已挂：/dsh-mnemo/api/*')
  } catch (error) {
    diag('管理接口挂不上：' + (error && error.message))
  }

  diag('mnemo 已加载，agents=' + (() => { try { return (ctx.agents.list() || []).length } catch { return '?' } })())
}
