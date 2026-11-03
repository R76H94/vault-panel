// vault-panel: one small, always-open pane with Google Calendar and vault Todos.
// Read-only: it never changes a calendar event or a Todo file.

// Paths come from the plugin's options (userConfig), set by whoever installs it.
// Each relative path is under the vault; an empty one turns its feature off.
let VAULT = "";
let TODO_DIR = "";
let WORKLOG = "";
let DIARY_DIR = "";
let DIARY_SCRIPT = "";
let CALENDAR_SERVER = "";

function configure(options = {}) {
  const clean = (value) => String(value ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const under = (value) => (clean(value) ? `${VAULT}/${clean(value).replace(/^\/+/, "")}` : "");
  VAULT = clean(options.vaultPath);
  TODO_DIR = under(options.todoDir);
  WORKLOG = under(options.worklogFile);
  DIARY_DIR = under(options.diaryDir);
  DIARY_SCRIPT = under(options.diaryScript);
  CALENDAR_SERVER = String(options.calendarServer ?? "").trim();
}

const SUMMARY_GAP_MS = 10 * 60 * 1000;
const NIGHT_HOUR = 20;
const PANE_NEXT_ITEMS = 3;
const PANE = "vault-panel";
// Inline the frame fits the tree up to these rows; docked it takes the column's height.
const PANE_ARGS = { id: PANE, title: "予定とTodo", rows: 14, columns: 34 };
const DEFAULT_BODY_ROWS = 14;
const TODAY_MAX_LINES = 4;
const TODO_MIN_ITEMS = 2;
const USAGE_WARN = 70;
const USAGE_ALERT = 90;
const REFRESH_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = "日月火水木金土";
const PRIORITY = { 高: 0, 中: 1, 低: 2 };
const CLOSED = new Set(["完了", "中止"]);

const calendar = { today: [], tomorrow: [], week: [], error: "", isLoading: true };
// Connectors join a moment after session.start, so the first calls may find none.
const CALENDAR_RETRY_MS = [1000, 2000, 4000, 8000, 15000];
const todos = { today: "", items: [], problems: [], error: "", isLoaded: false };
let nextItems = [];
let nowMs = 0;
let rateLimits = [];
let timer;

// The unfinished items of the newest entry in the work log.
async function loadNext($) {
  try {
    if (!WORKLOG) throw new Error("no work log");
    const entry = (await $.fs.read(WORKLOG)).split(/^## /m)[1] ?? "";
    nextItems = [...entry.matchAll(/^- \[ \] (.+?)\s*$/gm)].map((match) => match[1]);
  } catch {
    nextItems = [];
  }
  $.ui.invalidate("ui.render");
}

async function refreshLocal($) {
  nowMs = await $.clock.now();
  await Promise.all([loadTodos($), loadNext($)]);
}

async function hasReview($, date) {
  try {
    const path = `${DIARY_DIR}/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`;
    return (await $.fs.read(path)).includes("## 振り返り");
  } catch {
    return false;
  }
}

async function reviewReminder($, now, today) {
  if (!DIARY_DIR) return "";
  if (!(await hasReview($, addDays(today, -1)))) return "【振り返り】昨日の分がまだです。「振り返りをしたい」と話せば書けます";
  const isNight = new Date(now + JST_MS).getUTCHours() >= NIGHT_HOUR;
  if (isNight && !(await hasReview($, today))) return "【振り返り】今日の分は「振り返りをしたい」と話せば書けます";
  return "";
}

async function loadUsage($) {
  rateLimits = (await $.session.usage()).rateLimits ?? [];
  $.ui.invalidate("ui.render");
}

// "18:30" or "11/5木", when the limit resets, in Japan time.
function resetTime(limit) {
  if (!limit.resetsAt) return "";
  const shifted = new Date(Date.parse(limit.resetsAt) + JST_MS).toISOString();
  return limit.kind === "five_hour" ? shifted.slice(11, 16) : shortDate(shifted.slice(0, 10));
}

function eventLines(events) {
  return events.length ? events.map((event) => `- ${event.time} ${event.title}`) : ["- 予定なし"];
}

// Shown when a session starts: no model call. The first start of a day adds the
// day's events and creates diary drafts for past days.
async function startup($) {
  await Promise.all([loadCalendarRetrying($), refreshLocal($)]);
  const now = await $.clock.now();
  const lastAt = Number((await $.store.get("lastSummaryAt")) ?? 0);
  if (now - lastAt < SUMMARY_GAP_MS) return;
  await $.store.set("lastSummaryAt", now);

  const today = jstDate(now);
  const lines = [];
  if ((await $.store.get("lastDailyDate")) !== today) {
    await $.store.set("lastDailyDate", today);
    lines.push(`【おはようございます ${shortDate(today)}】`);
    lines.push(...(calendar.error ? [`- 予定を読めません: ${calendar.error}`] : eventLines(calendar.today)));
    if (DIARY_SCRIPT) {
      try {
        const { exitCode, stdout, stderr } = await $.process.run(["python", DIARY_SCRIPT], { cwd: VAULT });
        if (exitCode !== 0) lines.push(`日記の下書きを作れません: ${stderr.trim().slice(-200)}`);
        else if (stdout.trim()) lines.push(stdout.trim());
      } catch (error) {
        lines.push(`日記の下書きを作れません: ${error?.message ?? error}`);
      }
    }
  }
  const urgent = todos.items.filter((item) => item.due && item.due <= today);
  if (urgent.length) lines.push("【〆切】", ...urgent.map((item) => `- ${dueLabel(item).text} ${item.title}`));
  if (nextItems.length) lines.push("【前回の続き】", ...nextItems.map((item) => `- ${item}`));
  const reminder = await reviewReminder($, now, today);
  if (reminder) lines.push(reminder);
  if (lines.length) $.ui.log(lines.join("\n"));
}

function jstDate(ms) {
  return new Date(ms + JST_MS).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

function shortDate(date) {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}${WEEKDAYS[day]}`;
}

// One event as { date, time, title }. An all-day event has only start.date.
function toEvent(raw, today) {
  const start = raw.start ?? {};
  const shifted = start.dateTime ? new Date(Date.parse(start.dateTime) + JST_MS).toISOString() : "";
  const date = shifted ? shifted.slice(0, 10) : String(start.date ?? "").slice(0, 10);
  const endMs = Date.parse(raw.end?.dateTime ?? start.dateTime ?? "");
  return {
    date: date < today ? today : date,
    time: shifted ? shifted.slice(11, 16) : "終日",
    title: raw.summary || "（件名なし）",
    endMs: Number.isNaN(endMs) ? null : endMs,
  };
}

async function loadCalendar($) {
  try {
    const today = jstDate(await $.clock.now());
    if (!CALENDAR_SERVER) throw new Error("カレンダーのコネクタ名が未設定です");
    const result = await $.mcp.call(CALENDAR_SERVER, "list_events", {
      startTime: `${today}T00:00:00`,
      endTime: `${addDays(today, 8)}T00:00:00`,
      orderBy: "startTime",
      pageSize: 100,
    });
    const text = (result.content ?? []).map((block) => block.text ?? "").join("");
    if (result.isError) throw new Error(text || "カレンダーがエラーを返しました");
    const events = (JSON.parse(text).events ?? [])
      .filter((event) => event.status !== "cancelled")
      .map((event) => toEvent(event, today));
    const tomorrow = addDays(today, 1);
    calendar.today = events.filter((event) => event.date === today);
    calendar.tomorrow = events.filter((event) => event.date === tomorrow);
    calendar.week = events.filter((event) => event.date > tomorrow);
    calendar.error = "";
  } catch (error) {
    calendar.error = String(error?.message ?? error);
    $.ui.log(`vault-panel: 予定: ${calendar.error}`, { to: "debug" });
  }
  $.ui.invalidate("ui.render");
}

async function loadCalendarRetrying($) {
  await loadCalendar($);
  for (const delay of CALENDAR_RETRY_MS) {
    if (!calendar.error) break;
    await $.clock.sleep(delay);
    await loadCalendar($);
  }
  calendar.isLoading = false;
  $.ui.invalidate("ui.render");
}

function parseFrontmatter(text) {
  const block = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return null;
  const meta = {};
  for (const line of block[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_]+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (field) meta[field[1]] = field[2].replace(/^["']|["']$/g, "");
  }
  return meta;
}

// Only the files directly in the folder are Todos; subfolders hold reference notes.
async function collectTodoFiles($, dir) {
  const entries = await $.fs.list(dir);
  return entries
    .filter((entry) => entry.kind !== "dir" && entry.name.endsWith(".md"))
    .map((entry) => ({ path: `${dir}/${entry.name}`, name: entry.name }));
}

async function loadTodos($) {
  try {
    const today = jstDate(await $.clock.now());
    const items = [];
    const problems = [];
    if (!TODO_DIR) throw new Error("Todoのフォルダが未設定です");
    for (const file of await collectTodoFiles($, TODO_DIR)) {
      const meta = parseFrontmatter(await $.fs.read(file.path));
      if (!meta) {
        problems.push(`${file.name}: プロパティなし`);
        continue;
      }
      if (CLOSED.has(meta.status || "未着手")) continue;
      let due = "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(meta.due ?? "") && !Number.isNaN(Date.parse(meta.due))) due = meta.due;
      else if (meta.due) problems.push(`${file.name}: 〆切の形式が不正`);
      items.push({ title: meta.title || file.name.slice(0, -3), due, priority: meta.priority || "中" });
    }
    items.sort(
      (a, b) =>
        (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") ||
        (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1) ||
        a.title.localeCompare(b.title, "ja"),
    );
    todos.today = today;
    todos.items = items;
    todos.problems = problems;
    todos.error = "";
  } catch (error) {
    todos.error = String(error?.message ?? error);
    $.ui.log(`vault-panel: Todo: ${todos.error}`, { to: "debug" });
  }
  todos.isLoaded = true;
  $.ui.invalidate("ui.render");
}

// Theme keys follow the terminal's light or dark theme. Named colors are the fallback.
const COLOR = {
  usage: "inactive",
  calendar: "permission",
  todo: "planMode",
  next: "error",
  usageOk: "success",
  warn: "warning",
  alert: "error",
  band: "inverseText",
};
// A framed section costs two rows (top and bottom border).
const FRAME_ROWS = 2;
const FRAME_MIN_BODY_ROWS = 28;
const BAND_MIN_BODY_ROWS = 16;

function dueLabel(item) {
  if (!item.due) return { text: "期限なし" };
  const left = Math.round((Date.parse(item.due + "T00:00:00Z") - Date.parse(todos.today + "T00:00:00Z")) / DAY_MS);
  if (left < 0) return { text: `超過${-left}日`, color: COLOR.alert, bold: true };
  if (left === 0) return { text: "今日", color: COLOR.warn };
  return { text: `${left}日` };
}

// One row of the pane: { key, text, bold?, color?, dim? }, or { key, segments } for
// a row of differently styled pieces.
function row(key, text, style = {}) {
  return { key, text, ...style };
}

const USAGE_BAR_CELLS = 6;

function usageShortLabel(limit) {
  return { five_hour: "5h", seven_day: "週" }[limit.kind] ?? limit.kind;
}

function usageState(percent) {
  if (percent >= USAGE_ALERT) return { color: COLOR.alert, bold: true };
  if (percent >= USAGE_WARN) return { color: COLOR.warn };
  return { color: COLOR.usageOk };
}

// Terminal cells: wide (CJK) characters take two.
function cellWidth(text) {
  return [...text].reduce((sum, ch) => sum + (ch.codePointAt(0) >= 0x2e80 ? 2 : 1), 0);
}

function padCells(text, width) {
  return text + " ".repeat(Math.max(0, width - cellWidth(text)));
}

// Each limit takes a fixed-width column, so the reset row lines up under the bars:
//   5h ██░░░░  23%  週 ██░░░░  40%
//   5h 18:30         週 11/5木
const USAGE_COLUMN_CELLS = 2 + 1 + USAGE_BAR_CELLS + 1 + 4;
const USAGE_GAP = "  ";

function usageRows() {
  if (rateLimits.length === 0) return [row("usage-bars", "使用量 応答後に表示", { dim: true })];
  const segments = rateLimits.flatMap((limit, index) => {
    const percent = Math.max(0, Math.min(100, limit.percentUsed));
    const filled = Math.round((percent / 100) * USAGE_BAR_CELLS);
    const state = usageState(percent);
    return [
      { text: `${index ? USAGE_GAP : ""}${usageShortLabel(limit)} ` },
      { text: "█".repeat(filled), color: state.color },
      { text: "░".repeat(USAGE_BAR_CELLS - filled), dim: true },
      { text: ` ${`${Math.round(percent)}%`.padStart(4)}`, ...(percent >= USAGE_WARN ? state : {}) },
    ];
  });
  const rows = [{ key: "usage-bars", segments }];
  // Always a second row with every reset time, each under its own bar.
  // A limit at 70% or more is colored (90% or more also gets "!" after the time).
  if (rateLimits.some((limit) => resetTime(limit))) {
    const last = rateLimits.length - 1;
    const resetSegments = rateLimits.map((limit, index) => {
      const until = resetTime(limit);
      const high = limit.percentUsed >= USAGE_WARN;
      const alert = limit.percentUsed >= USAGE_ALERT;
      const body = until ? `${usageShortLabel(limit)} ${until}${alert ? "!" : ""}` : "";
      return {
        text: `${index ? USAGE_GAP : ""}${index < last ? padCells(body, USAGE_COLUMN_CELLS) : body}`,
        ...(high ? usageState(limit.percentUsed) : { dim: true }),
      };
    });
    rows.push({ key: "usage-reset", segments: resetSegments });
  }
  return rows;
}

function usageFrameColor() {
  const worst = Math.max(0, ...rateLimits.map((limit) => limit.percentUsed));
  if (worst >= USAGE_ALERT) return COLOR.alert;
  return worst >= USAGE_WARN ? COLOR.warn : COLOR.usage;
}

function isPast(event) {
  return event.endMs !== null && nowMs > 0 && event.endMs <= nowMs;
}

function todayEventRows() {
  const events = calendar.today;
  if (events.length === 0) return [row("today-none", "予定なし", { dim: true })];
  const shown = events.length > TODAY_MAX_LINES ? events.slice(0, TODAY_MAX_LINES - 1) : events;
  const rows = shown.map((event, index) => row(`today${index}`, `${event.time} ${event.title}`, { dim: isPast(event) }));
  if (shown.length < events.length) rows.push(row("today-more", `ほか ${events.length - shown.length}件`, { dim: true }));
  return rows;
}

function tomorrowRow() {
  const [first, ...rest] = calendar.tomorrow;
  if (!first) return row("tomorrow", "明日 予定なし", { dim: true });
  return row("tomorrow", `明日 ${first.time} ${first.title}${rest.length ? ` ほか${rest.length}` : ""}`);
}

// The todo items in `lines` rows: all of them, or lines-1 and a "ほか" row.
function todoItemRows(lines) {
  const items = todos.items;
  const shown = items.length > lines ? items.slice(0, Math.max(lines - 1, 0)) : items;
  const rows = shown.map((item, index) => {
    const { text, ...style } = dueLabel(item);
    return row(`item${index}`, `${text} ${item.title}`, style);
  });
  const hidden = items.slice(shown.length);
  if (hidden.length) {
    const urgent = hidden.some((item) => item.due && item.due <= todos.today);
    rows.push(row("item-more", `ほか ${hidden.length}件`, urgent ? { color: COLOR.warn } : { dim: true }));
  }
  return rows;
}

// A section: { id, color, heading?, rows, isFramed }. `heading` is drawn as a band or a bold row.
function sectionRows(section, frameRows) {
  return section.rows.length + (section.heading ? 1 : 0) + (section.isFramed ? frameRows : 0);
}

// Sections fill top-down by priority; what does not fit becomes a "ほか N件" row or is left out.
// Returns the sections and the rows left (negative when the minimum overflows).
function paneSections(budget, frameRows) {
  const sections = [];
  let room = budget;
  const add = (section) => {
    sections.push(section);
    room -= sectionRows(section, frameRows);
    return section;
  };

  add({ id: "usage", color: usageFrameColor(), rows: usageRows(), isFramed: rateLimits.length > 0 });

  let calendarSection = null;
  if (calendar.error && calendar.isLoading) {
    add({ id: "calendar", rows: [row("today", "今日 予定を読み込み中…", { dim: true })] });
  } else if (calendar.error) {
    add({
      id: "calendar",
      rows: [row("today", "今日 予定を読めません", { color: COLOR.alert }), row("today-hint", "接続を確認。/panel で再読込", { dim: true })],
    });
  } else {
    calendarSection = add({
      id: "calendar",
      color: COLOR.calendar,
      heading: row("today", `今日 ${shortDate(todos.today || jstDate(nowMs))}`),
      rows: [...todayEventRows(), tomorrowRow()],
      isFramed: true,
    });
  }

  const problemRows = !todos.error && todos.problems.length ? [row("problems", `要確認 ${todos.problems.length}件`, { color: COLOR.warn })] : [];
  const hasItems = !todos.error && todos.isLoaded && todos.items.length > 0;
  let todoSection = null;
  let todoLines = 0;
  if (todos.error) {
    add({ id: "todo", rows: [row("todo", "Todo を読めません", { color: COLOR.alert }), row("todo-hint", "/panel で再読込", { dim: true })] });
  } else if (!todos.isLoaded) {
    add({ id: "todo", rows: [row("todo", "Todo を読み込み中…", { dim: true })] });
  } else if (!hasItems) {
    add({ id: "todo", rows: [row("todo", "Todo なし", { dim: true }), ...problemRows] });
  } else {
    todoSection = add({ id: "todo", color: COLOR.todo, heading: row("todo", `Todo ${todos.items.length}件`), rows: problemRows, isFramed: true });
    // The minimum stays even when it overflows: urgent todos matter more than the sections below.
    todoLines = todos.items.length <= TODO_MIN_ITEMS ? todos.items.length : TODO_MIN_ITEMS + 1;
    room -= todoLines;
  }

  if (nextItems.length) {
    const full = Math.min(nextItems.length, PANE_NEXT_ITEMS);
    if (room >= 1 + full + frameRows) {
      add({
        id: "next",
        color: COLOR.next,
        heading: row("next", `次 ${nextItems.length}件`),
        rows: nextItems.slice(0, full).map((item, index) => row(`next${index}`, item)),
        isFramed: true,
      });
    } else if (room >= 1) {
      add({ id: "next", rows: [row("next", `次 ${nextItems.length}件 先頭：${nextItems[0]}`, { bold: true })] });
    }
  }

  if (calendarSection && room >= 1) {
    const count = calendar.week.length;
    calendarSection.rows.push(row("week", count ? `今週 ${count}件` : "今週 予定なし", { dim: !count }));
    room -= 1;
  }

  if (todoSection) {
    const lines = Math.min(todos.items.length, todoLines + Math.max(room, 0));
    room -= lines - todoLines;
    todoSection.rows = [...todoItemRows(lines), ...problemRows];
  }
  return { sections, room };
}

function rowText(Text, item) {
  const { key, text, bold, color, dim, segments } = item;
  if (segments) {
    const pieces = segments.map((piece, index) =>
      Text({ key: `${key}-${index}`, bold: piece.bold || undefined, color: piece.color, dimColor: piece.dim || undefined, children: piece.text }),
    );
    return Text({ key, wrap: "truncate-end", children: pieces });
  }
  return Text({ key, wrap: "truncate-end", bold: bold || undefined, color, dimColor: dim || undefined, children: text });
}

// The heading as a colored band across the width.
function band(Box, Text, heading, color) {
  return Box({
    key: `${heading.key}-band`,
    backgroundColor: color,
    paddingX: 1,
    children: Text({ wrap: "truncate-end", bold: true, color: COLOR.band, backgroundColor: color, children: heading.text }),
  });
}

// tier: "frame" (rounded border per section), "band" (colored headings), "plain" (bold headings).
function sectionView(Box, Text, section, tier) {
  const body = section.rows.map((item) => rowText(Text, item));
  if (section.heading) {
    body.unshift(tier === "plain" ? rowText(Text, { ...section.heading, bold: true }) : band(Box, Text, section.heading, section.color));
  }
  if (tier === "frame" && section.isFramed) {
    return [Box({ key: section.id, flexDirection: "column", borderStyle: "round", borderColor: section.color, paddingX: 1, children: body })];
  }
  return body;
}

function panelView($, e) {
  const { Box, Text } = $.ui.resolve(e);
  const bodyRows = e.props?.scroll?.bodyRows;
  const budget = bodyRows > 0 ? bodyRows : DEFAULT_BODY_ROWS;
  let tier = budget >= BAND_MIN_BODY_ROWS ? "band" : "plain";
  let layout = paneSections(budget, 0);
  if (budget >= FRAME_MIN_BODY_ROWS) {
    const framed = paneSections(budget, FRAME_ROWS);
    if (framed.room >= 0) {
      tier = "frame";
      layout = framed;
    }
  }
  const children = layout.sections.flatMap((section) => sectionView(Box, Text, section, tier));
  return Box({ flexDirection: "column", children });
}

export function register(on, options) {
  configure(options);
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: "panel", description: "予定とTodoのペインを開いて最新にし、次にやることを全部出す" });
    await $.ui.open(PANE_ARGS);
    await loadUsage($);
    void startup($).catch((error) => $.ui.log(`vault-panel: ${error?.message ?? error}`, { to: "debug" }));
    timer?.cancel();
    timer = $.clock.every(REFRESH_MS, () => {
      void loadCalendar($);
      void refreshLocal($);
    });
    return result;
  });

  on("command.run", { command: "panel" }, async ($) => {
    await $.ui.open(PANE_ARGS);
    await Promise.all([loadCalendarRetrying($), refreshLocal($)]);
    const lines = [calendar.error || todos.error ? "一部を読み込めませんでした。ペインを確認してください。" : "予定とTodoを更新しました。"];
    if (nextItems.length) lines.push("", `次にやること（${nextItems.length}件）`, ...nextItems.map((item) => `- ${item}`));
    return { text: lines.join("\n") };
  });

  // Claude may have added or finished a Todo during the turn.
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) {
      await refreshLocal($);
      if (calendar.error && !calendar.isLoading) void loadCalendar($);
    }
    return result;
  });

  on("session.measure", async ($, e, next) => {
    const result = await next(e);
    rateLimits = e.rateLimits ?? [];
    $.ui.invalidate("ui.render");
    return result;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e) => panelView($, e));
}
