import { expect, test } from 'claude-code/testing'

const OPTIONS = {
  options: {
    vaultPath: 'C:\\vault\\',
    todoDir: '0009_todo',
    worklogFile: '0010_projects/作業記録.md',
    diaryDir: '0001_diary',
    diaryScript: '.claude/scripts/daily_draft.py',
    calendarServer: 'claude.ai Google Calendar',
  },
}

const NOW = Date.parse('2026-11-01T08:00:00Z') // 17:00 JST

const PANE = {
  plugin: 'vault-panel',
  component: 'Pane',
  requestId: 'vault-panel',
  surface: 'terminal',
  props: {
    title: '予定とTodo',
    isFocused: false,
    bodyColumns: 34,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as any

const CALENDAR = {
  events: [
    { summary: '歯医者', status: 'confirmed', start: { dateTime: '2026-11-01T14:00:00+09:00' } },
    { summary: '中止した予定', status: 'cancelled', start: { dateTime: '2026-11-01T15:00:00+09:00' } },
    { summary: '深夜の予定', status: 'confirmed', start: { dateTime: '2026-11-04T01:30:00+09:00' } },
  ],
}

const FILES: Record<string, string> = {
  'late.md': '---\ntitle: 来週の本\nstatus: 未着手\ndue: 2026-11-08\n---\n',
  'old.md': '---\ntitle: 牛乳\nstatus: 進行中\ndue: 2026-10-30\n---\n',
  'done.md': '---\ntitle: 完了済み\nstatus: 完了\ndue: 2026-10-01\n---\n',
  'none.md': '---\ntitle: いつか\nstatus: 未着手\ndue: \n---\n',
  'bad.md': '本文のみ',
}

const WORKLOG = '# 作業記録\n\n## 2026-11-01 新しい\n\n- [x] 済み\n- [ ] 次の作業\n\n## 2026-10-31 古い\n\n- [ ] 古い作業\n'

const state = { mcpFailures: 0 }

function engine(on: any, opened: any[] = [], logs: string[] = [], runs: any[] = [], store: Record<string, unknown> = {}) {
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.log', (_: unknown, e: any) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_: unknown, e: any) => {
    runs.push(e)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: {},
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-01T09:30:00Z' },
        { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-05T01:00:00Z' },
      ],
    },
  }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('ui.open', (_: unknown, e: any) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('mcp.call', () => {
    if (state.mcpFailures > 0) {
      state.mcpFailures--
      throw new Error('no connected MCP tool')
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify(CALENDAR) }] } }
  })
  on('fs.list', () => ({
    value: [
      ...Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
      { name: '応用情報', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', (_: unknown, e: any) => {
    const name = String(e.path).split(/[\\/]/).pop() as string
    return { value: name === '作業記録.md' ? WORKLOG : FILES[name] }
  })
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

test('the first start of a day summarizes once and runs the diary script', OPTIONS, async ($, on) => {
  const logs: string[] = []
  const runs: any[] = []
  const store: Record<string, unknown> = {}
  engine(on, [], logs, runs, store)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(runs.length).toBe(1)
  expect(JSON.stringify(runs[0])).toContain('C:/vault"')
  expect(logs.length).toBe(1)
  expect(logs[0]).toContain('14:00 歯医者')
  expect(logs[0]).toContain('超過2日 牛乳')
  expect(logs[0]).toContain('次の作業')
  expect(logs[0]).toContain('昨日の分がまだです')
  expect(logs[0]).not.toContain('古い作業')

  store.lastSummaryAt = NOW - 60 * 60 * 1000
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(runs.length).toBe(1)
  expect(logs.length).toBe(2)
  expect(logs[1]).not.toContain('歯医者')
})

test('the pane opens by itself, small and without taking the keyboard', OPTIONS, async ($, on) => {
  const opened: any[] = []
  engine(on, opened)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened[0].id).toBe('vault-panel')
  expect(opened[0].columns).toBe(34)
  expect(opened[0].focus).toBeUndefined()
  await settle()
})

const paneWith = (bodyRows: number) => ({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } })

test('one pane shows the calendar and the todos compactly', OPTIONS, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  const reply: any = await $.command.run({ command: 'panel', args: '' } as any)
  expect(reply.text).toContain('- 次の作業')
  const ui = await $.ui.mount(PANE)
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text }))?.text
  expect(await has(/^今日 11\/1日$/)).toBeTruthy()
  expect(await has(/^14:00 歯医者$/)).toBeTruthy()
  expect(await has(/^明日 予定なし$/)).toBeTruthy()
  const bars: any = await ui.find({ type: 'Text', text: /^5h / })
  expect(bars?.text).toBe('5h █░░░░░  24%  週 █████░  91%')
  expect(bars?.children[1].props.color).toBe('success')
  expect(bars?.children[5].props.color).toBe('error')
  const resets: any = await ui.find({ type: 'Text', text: /^5h \d/ })
  expect(resets?.text).toBe('5h 18:30        週 11/5木!')
  expect(resets?.text.indexOf('週')).toBe(bars?.text.indexOf('週'))
  expect(resets?.children[0].props.dimColor).toBeTruthy()
  expect(resets?.children[1].props.color).toBe('error')
  expect(await has(/回復/)).toBeFalsy()
  expect(await has(/^今週 1件$/)).toBeTruthy()
  expect(await has(/──/)).toBeFalsy()
  expect(await has(/^Todo 3件$/)).toBeTruthy()
  expect(await has(/^超過2日 牛乳$/)).toBeTruthy()
  expect(await has(/^7日 来週の本$/)).toBeTruthy()
  expect(await has(/^期限なし いつか$/)).toBeTruthy()
  expect(await has(/^要確認 1件$/)).toBeTruthy()
  expect(await has(/^次 1件$/)).toBeTruthy()
  expect(await has(/中止した予定/)).toBeFalsy()
  expect(await has(/完了済み/)).toBeFalsy()
  await ui.unmount()
})

test('a short pane keeps the todos and drops what comes after', OPTIONS, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  const ui = await $.ui.mount(paneWith(9))
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text }))?.text
  expect(await has(/^超過2日 牛乳$/)).toBeTruthy()
  expect(await has(/^7日 来週の本$/)).toBeTruthy()
  expect(await has(/^期限なし いつか$/)).toBeTruthy()
  expect(await has(/^次/)).toBeFalsy()
  expect(await has(/^今週/)).toBeFalsy()
  await ui.unmount()
})

test('a tall pane frames each section in its color; a shorter one keeps only the bands', OPTIONS, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  const tall = await $.ui.mount(paneWith(30))
  const todoBox = await tall.find({ key: 'todo' })
  expect(todoBox?.type).toBe('Box')
  expect(todoBox?.props.borderStyle).toBe('round')
  expect(todoBox?.props.borderColor).toBe('planMode')
  expect((await tall.find({ key: 'usage' }))?.props.borderColor).toBe('error')
  expect((await tall.find({ key: 'next' }))?.props.borderColor).toBe('error')
  expect((await tall.find({ key: 'today-band' }))?.props.backgroundColor).toBe('permission')
  expect((await tall.find({ type: 'Text', text: /^超過2日 牛乳$/ }))?.props.color).toBe('error')
  await tall.unmount()

  const middle = await $.ui.mount(paneWith(20))
  expect((await middle.find({ key: 'todo-band' }))?.props.backgroundColor).toBe('planMode')
  expect(await middle.find({ key: 'calendar' })).toBeFalsy()
  await middle.unmount()

  const short = await $.ui.mount(paneWith(9))
  expect(await short.find({ key: 'todo-band' })).toBeFalsy()
  await short.unmount()
})

test('the calendar is retried until the connector has joined', OPTIONS, async ($, on) => {
  state.mcpFailures = 2
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^14:00 歯医者$/ }))?.text).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /予定を読めません/ })).toBeFalsy()
  await ui.unmount()
})

test('without a work log or diary, the pane and the summary leave those parts out', { options: { vaultPath: 'C:/vault', todoDir: '0009_todo' } }, async ($, on) => {
  const logs: string[] = []
  const runs: any[] = []
  engine(on, [], logs, runs, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(runs.length).toBe(0)
  expect(logs[0]).not.toContain('振り返り')
  expect(logs[0]).not.toContain('次の作業')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^超過2日 牛乳$/ }))?.text).toBeTruthy()
  expect(await ui.find({ key: 'next-band' })).toBeFalsy()
  await ui.unmount()
})
