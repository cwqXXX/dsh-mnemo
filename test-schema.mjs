// Smoke test for the patched mnemo plugin: fake ctx, verify tool schemas.
const mod = await import('file:///C:/Users/XXX/Documents/deepseek-harness/default-workspace/work/dsh-mnemo/index.js')

const registered = []
const fakeCtx = {
  on() { return () => {} },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  interval() { return () => {} },
  agents: {
    list() { return [agent] },
  },
}

const agent = {
  ctx: {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on() { return () => {} },
    tools: { register(t) { registered.push(t); return () => {} } },
    systemPrompt: {
      section(o) { return () => {} },
      context(o) { return () => {} },
    },
  },
}

mod.apply(fakeCtx)

console.log('registered:', registered.map((t) => t.name).join(', '))
let bad = 0
for (const t of registered) {
  const p = t.parameters || {}
  const ok = p.type === 'object' && p.properties && typeof p.properties === 'object'
  if (!ok) bad++
  console.log(`${t.name}: type=${p.type} props=${Object.keys(p.properties || {}).join('/')} required=${JSON.stringify(p.required || [])} ${ok ? 'OK' : 'BAD'}`)
}
console.log(bad === 0 ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exit(bad === 0 && registered.length === 3 ? 0 : 1)
