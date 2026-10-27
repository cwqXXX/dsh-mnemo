// dsh-mnemo 客户端：设置 → 鲸忆
//
// 纯 JavaScript，无构建步骤。通过宿主 /dsh-mnemo/api/* 读写记忆，
// 样式只用 --dsw-alias-* 主题 token，亮/暗色都跟着宿主走。

window.__ModuleLoader__.load({
  id: 'dsh-mnemo',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useMemo, useCallback } = React
    const h = React.createElement

    const KINDS = [
      ['rule', '规则'],
      ['pitfall', '坑'],
      ['pref', '偏好'],
      ['fact', '事实'],
      ['task', '任务'],
      ['event', '事件'],
    ]
    const KIND_LABEL = Object.fromEntries(KINDS)
    const KIND_STYLE = {
      rule: { color: 'var(--dsw-alias-brand-primary)', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)' },
      pitfall: { color: 'var(--dsw-alias-state-warn-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)' },
      pref: { color: 'var(--dsw-alias-state-success-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)' },
      fact: { color: 'var(--dsw-alias-label-secondary)', background: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent)' },
      task: { color: 'var(--dsw-alias-label-secondary)', background: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent)' },
      event: { color: 'var(--dsw-alias-label-secondary)', background: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent)' },
    }

    async function api(path, body) {
      const init = body
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}
      const res = await fetch('/dsh-mnemo/api/' + path, init)
      let data = null
      try { data = await res.json() } catch { data = null }
      if (!res.ok || !data || data.ok === false) {
        throw new Error((data && data.error) || ('HTTP ' + res.status))
      }
      return data
    }

    const S = {
      wrap: {
        display: 'flex', flexDirection: 'column', gap: '14px',
        padding: '2px 0 28px', color: 'var(--dsw-alias-label-primary)',
        fontSize: '14px', lineHeight: 1.55,
      },
      head: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '16px', fontWeight: 600 },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      toolbar: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
      input: {
        flex: '1 1 220px', minWidth: '160px', padding: '7px 10px', fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', outline: 'none',
      },
      select: {
        padding: '7px 8px', fontSize: '13px', color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
      },
      btn: {
        padding: '6px 11px', fontSize: '13px', cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)', background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px',
      },
      btnPrimary: {
        padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontWeight: 500,
        color: 'var(--dsw-alias-bg-base)', background: 'var(--dsw-alias-brand-primary)',
        border: '1px solid transparent', borderRadius: '8px',
      },
      list: { display: 'flex', flexDirection: 'column', gap: '8px' },
      row: {
        display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      badge: {
        flex: '0 0 auto', marginTop: '1px', padding: '1px 7px', fontSize: '11px',
        borderRadius: '999px', fontWeight: 500, whiteSpace: 'nowrap',
      },
      body: { flex: '1 1 auto', minWidth: 0 },
      text: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      meta: { marginTop: '4px', display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      actions: { display: 'flex', gap: '4px', flex: '0 0 auto' },
      iconBtn: {
        padding: '3px 7px', fontSize: '12px', cursor: 'pointer', lineHeight: 1.4,
        color: 'var(--dsw-alias-label-secondary)', background: 'transparent',
        border: '1px solid transparent', borderRadius: '6px',
      },
      form: {
        display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      textarea: {
        width: '100%', boxSizing: 'border-box', minHeight: '68px', resize: 'vertical',
        padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', outline: 'none',
      },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' },
      empty: { padding: '18px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' },
    }

    function KindBadge({ kind }) {
      return h('span', {
        style: Object.assign({}, S.badge, KIND_STYLE[kind] || KIND_STYLE.fact),
      }, KIND_LABEL[kind] || kind)
    }

    function shortDate(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const [showDeleted, setShowDeleted] = useState(false)
      const [adding, setAdding] = useState(false)
      const [draft, setDraft] = useState({ text: '', kind: 'fact', pinned: false })
      const [editing, setEditing] = useState(null) // { id, text }

      const refresh = useCallback(async () => {
        try {
          const r = await api('list')
          setData(r)
          setError('')
        } catch (e) {
          setError(String(e.message || e))
        }
      }, [])

      useEffect(() => { refresh() }, [refresh])

      const run = useCallback(async (fn) => {
        setBusy(true)
        try {
          await fn()
          await refresh()
          setError('')
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy(false)
        }
      }, [refresh])

      const stats = data && data.stats ? data.stats : { live: 0, rules: 0, deleted: 0, total: 0 }
      const entries = data && data.entries ? data.entries : []

      const visible = useMemo(() => {
        const q = query.trim().toLowerCase()
        const out = entries.filter((e) => {
          if (!showDeleted && e.deletedAt) return false
          if (showDeleted && !e.deletedAt) return false
          if (e.supersededBy) return false
          if (filter !== 'all' && e.kind !== filter) return false
          if (q && !(e.text.toLowerCase().includes(q) || (e.tags || []).join(' ').toLowerCase().includes(q))) return false
          return true
        })
        const rank = (e) => (e.pinned ? 0 : 2) + (e.kind === 'rule' || e.kind === 'pitfall' ? 0 : 1)
        out.sort((a, b) => rank(a) - rank(b) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
        return out
      }, [entries, query, filter, showDeleted])

      function createEntry() {
        const text = draft.text.trim()
        if (!text) { setError('内容不能为空'); return }
        run(async () => {
          await api('create', { text, kind: draft.kind, pinned: draft.pinned })
          setDraft({ text: '', kind: 'fact', pinned: false })
          setAdding(false)
        })
      }

      function saveEdit() {
        if (!editing) return
        const text = editing.text.trim()
        if (!text) { setError('内容不能为空'); return }
        const target = editing
        run(async () => {
          await api('update', { id: target.id, text })
          setEditing(null)
        })
      }

      return h('div', { style: S.wrap },
        h('div', { style: S.head },
          h('h3', { style: S.title }, '鲸忆'),
          h('span', { style: S.muted }, '跨会话长期记忆 · 有效 ' + stats.live + ' 条 · 其中规则/坑 ' + stats.rules + ' 条'),
        ),
        h('div', { style: S.toolbar },
          h('input', {
            style: S.input,
            placeholder: '搜索内容或标签…',
            value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
          h('select', {
            style: S.select,
            value: filter,
            onChange: (e) => setFilter(e.target.value),
          }, h('option', { value: 'all' }, '全部类型'), KINDS.map(([k, label]) => h('option', { key: k, value: k }, label))),
          h('button', {
            style: S.btn,
            onClick: () => setShowDeleted((v) => !v),
          }, showDeleted ? '看有效' : '看已删 (' + stats.deleted + ')'),
          h('button', {
            style: S.btnPrimary,
            onClick: () => { setAdding((v) => !v); setError('') },
          }, adding ? '取消' : '新增'),
          h('button', { style: S.btn, disabled: busy, onClick: refresh }, '刷新'),
        ),
        error ? h('div', { style: S.error }, error) : null,
        adding ? h('div', { style: S.form },
          h('textarea', {
            style: S.textarea,
            placeholder: '一句话一件事，写清结论和条件；别写「今天/昨天」，时间由系统记。',
            value: draft.text,
            onChange: (e) => setDraft({ ...draft, text: e.target.value }),
          }),
          h('div', { style: S.toolbar },
            h('select', {
              style: S.select,
              value: draft.kind,
              onChange: (e) => setDraft({ ...draft, kind: e.target.value }),
            }, KINDS.map(([k, label]) => h('option', { key: k, value: k }, label))),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
              h('input', {
                type: 'checkbox',
                checked: draft.pinned,
                onChange: (e) => setDraft({ ...draft, pinned: e.target.checked }),
              }),
              '每轮注入（只给硬规则用）',
            ),
            h('span', { style: { flex: '1 1 auto' } }),
            h('button', { style: S.btnPrimary, disabled: busy, onClick: createEntry }, '记住'),
          ),
        ) : null,
        h('div', { style: S.list },
          visible.length === 0
            ? h('div', { style: S.empty }, showDeleted ? '没有已删除的记忆' : '没有匹配的记忆')
            : visible.map((e) => h('div', {
              key: e.id,
              style: Object.assign({}, S.row, e.deletedAt ? { opacity: 0.6 } : null),
            },
              h(KindBadge, { kind: e.kind }),
              h('div', { style: S.body },
                editing && editing.id === e.id
                  ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h('textarea', {
                      style: S.textarea,
                      value: editing.text,
                      onChange: (ev) => setEditing({ id: e.id, text: ev.target.value }),
                    }),
                    h('div', { style: S.toolbar },
                      h('button', { style: S.btnPrimary, disabled: busy, onClick: saveEdit }, '保存'),
                      h('button', { style: S.btn, onClick: () => setEditing(null) }, '取消'),
                    ),
                  )
                  : h('div', { style: S.text }, e.text),
                h('div', { style: S.meta },
                  h('span', null, e.pinned ? '📌 每轮注入' : '按需召回'),
                  h('span', null, e.scope === 'global' ? '全局' : e.scope),
                  h('span', null, '重要度 ' + Number(e.importance || 0).toFixed(2)),
                  h('span', null, '用过 ' + (e.useCount || 0) + ' 次'),
                  h('span', null, shortDate(e.updatedAt || e.createdAt)),
                ),
              ),
              h('div', { style: S.actions },
                e.deletedAt
                  ? [
                    h('button', {
                      key: 'restore', style: S.iconBtn, disabled: busy,
                      onClick: () => run(async () => { await api('update', { id: e.id, deleted: false }) }),
                    }, '恢复'),
                    h('button', {
                      key: 'purge', style: S.iconBtn, disabled: busy,
                      onClick: () => run(async () => { await api('purge', { id: e.id }) }),
                    }, '彻底删'),
                  ]
                  : [
                    h('button', {
                      key: 'pin', style: S.iconBtn, disabled: busy, title: e.pinned ? '取消每轮注入' : '设为每轮注入',
                      onClick: () => run(async () => { await api('update', { id: e.id, pinned: !e.pinned }) }),
                    }, e.pinned ? '取消钉' : '钉住'),
                    h('button', {
                      key: 'edit', style: S.iconBtn, disabled: busy,
                      onClick: () => setEditing({ id: e.id, text: e.text }),
                    }, '改'),
                    h('button', {
                      key: 'del', style: S.iconBtn, disabled: busy,
                      onClick: () => run(async () => { await api('delete', { id: e.id }) }),
                    }, '删'),
                  ],
              ),
            )),
        ),
        h('div', { style: S.muted },
          '数据在 ~/.dsh/mnemo/memory.json，MEMORY.md 是镜像。规则/坑会每轮注入，其余按相关度召回。'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'mnemo',
          order: 70,
          label: '鲸忆',
        }, Panel))
      },
    }
  },
})
