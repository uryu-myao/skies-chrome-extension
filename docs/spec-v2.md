# Skies v2 — 功能规格

本文件是 v2 开发的唯一事实来源。实现与本文冲突时,先改本文再改代码。

---

## 1. 范围

三个新功能,共享同一份数据模型:

| 功能      | 说明                   | 层级                         |
| --------- | ---------------------- | ---------------------------- |
| Core Time | 一组条目的工作时段交集 | 免费(默认工时) / Pro(自定义) |
| DST 预警  | 时差变化的前瞻提醒     | Pro                          |
| 设置页    | 全局偏好集中管理       | 免费                         |

**人物模式已推迟到下一版。** 但其数据字段(`person`、`groups`)在本版 schema 中保留并写入存储,仅不渲染。目的是避免将来再做一次迁移。

不在本次范围内:人物模式 UI、分组管理、头像上传、通讯录字段、导入外部数据、日历集成。

---

## 2. 数据模型

### 2.1 v2 Schema

```js
{
  version: 2,
  entries: [
    {
      id: "e_01",              // 稳定唯一 ID,迁移时生成后不再变更
      timezone: "Europe/Berlin",  // IANA ID,唯一必填字段
      label: "Berlin",         // 显示名,默认取城市名;可在城市设置面板中改名
      defaultLabel: "Berlin",  // 添加时的城市名,城市名「重置」恢复到它;旧数据缺省时
                               // 以当前 label 为准(改名前才会被记下)
      person: null,            // 【本版保留不用】{ name, initials, color, note }
      workHours: null,         // 或 { start: 9, end: 18 },null = 用全局默认
      workDays: null,          // 或 [1,2,3,4,5],null = 用全局默认
      includeInCoreTime: true,
      pinned: false,           // 【废弃】不再有任何 UI 表现;仅迁移时读取一次,见 §3.4
      groups: [],              // 【本版保留不用】group id 数组
      order: 0                 // 列表位置,0 = 最上;手动顺序是唯一顺序,见 §3.4
    }
  ],
  groups: [],                  // 【本版保留不用】{ id, name }
  settings: {
    hour24: true,
    showSeconds: false,
    sortOrder: "manual",       // 【废弃】manual | offset | name(由 v1 的 newest | time | alphabet
                               // 映射而来,见 §3.2);仅迁移时读取一次,见 §3.4
    referenceTimezone: null,   // null = 使用系统时区;所有时间计算只读它
    referenceEntryId: null,    // 可选。用户在基准 chip 中选了哪个条目,只用于 chip 的名称与选中态
                               // (§9.1);旧数据没有该字段,按时区回退
    defaultWorkHours: { start: 9, end: 18 },
    defaultWorkDays: [1, 2, 3, 4, 5],
    coreTimePanel: "always",   // always | collapsed | hidden
    dstBannerEnabled: true,
    dstLeadDays: 14,
    dstNotificationEnabled: false
  }
}
```

### 2.2 关键约定

**`workHours` / `workDays` 为 `null` 表示「继承全局默认」,不是「无工作时间」。**
这个区分是 UI 上「default 灰字 / 自定义白字」的依据,不能用 `{start:9,end:18}` 代替 `null`。
读取时统一走 `resolveWorkHours(entry, settings)`,禁止在渲染层直接读 `entry.workHours`。

**`workDays` 使用 0=周日 … 6=周六**,与 `Date.getDay()` 一致。

**`person` 为 `null` 时,条目渲染为普通城市卡片**,不占用头像列。

### 2.3 存储

所有读写都经过存储适配层。`core/` 只认注入的 `KeyValueStore`(`core/store.ts`,见 §12),
不知道底下是哪种存储。后端在 `src/platform/storage/`,按构建目标在编译期选定(`__TARGET__`),
一个包里只带自己那一种:

| 构建目标 | 后端 | 说明 |
| -------- | ---- | ---- |
| Chrome | popup 页的 `localStorage` | 与 3.1.2 相同。Chrome 用户的数据不搬家、不换位置 |
| Firefox | `browser.storage.local` | 用户清除浏览数据(Cookie 与网站数据)时,Firefox 会清掉扩展的 `localStorage`,`storage.local` 不受影响。需要 `storage` 权限,它不产生用户可见的警告(§6.3) |

- **两个后端的 key 名与值的格式完全相同**:同样的 `timemate.*` key,值同样是字符串(JSON,
  或 v1 的纯字符串,§3.2)。`storage.local` 里也存字符串,不存对象,两边的数据可以原样互搬。
- 对上层是同步的。Firefox 后端在第一次渲染前用 `init()` 把 `storage.local` 一次性读进内存,
  之后 `get` 只读内存;`set` / `remove` 先改内存,再**立即**发起写入:
  - **不防抖、不合并**:popup 随时可能被关掉,留在防抖窗口里的写入会丢。
  - 写入**按调用顺序串行**执行,不会乱序。
  - 写入失败:`console.error`,并把该 key 在内存里退回到存储中已确认的值 —— 内存与存储保持
    一致,不留下写了一半的状态。需要确认结果的调用方(迁移,§3.1)用 `flush()`:此前发起的写入
    全部完成后 resolve,其中任何一次失败则 reject。Chrome 后端的写入是同步的,失败照旧同步抛错,
    `flush()` 立即 resolve。
  - `init()` 读取失败时,**不得当作全新安装** —— 那样会用默认数据覆盖用户真实的存储。此时只读
    运行:本次打开显示默认数据,所有写入被拒绝并 `console.error`,存储里的原数据不动。
- 只有持久数据(`timemate.data.v2`、`timemate.backup_v1`、v1 的 key)经过适配层。3.1.x 在
  `localStorage` 里留下的日出日落缓存 `timemate.sun.*` 已不再使用(天色改为本地计算,§9.2),每次打开
  popup 从 `localStorage` 删除残留,不经过适配层。

---

## 3. 迁移 v1 → v2

**所有 storage key 保留 `timemate.` 前缀,改名后不得变更**(产品已从 TimeMate 两次改名,现为 Skies)。
key 是老用户数据所在的位置,改一个字就等于让所有老用户的城市消失。扩展 ID 同理:Chrome 的
`localStorage` 按扩展的 origin(`chrome-extension://<ID>/`)隔离,Firefox 的 `storage.local` 按
add-on ID(`skies@useskies.com`)隔离,ID 变了,旧数据同样读不到。

存储位置见 §2.3(Chrome 为 `localStorage`,Firefox 为 `storage.local`)。key 如下,两个后端相同:

| key                         | 内容                                             |
| --------------------------- | ------------------------------------------------ |
| `timemate.data.v2`          | v2 数据(§2.1)                                   |
| `timemate.backup_v1`        | 迁移前的 v1 快照,只写一次                        |
| `timemate.timezones.v1`     | v1 城市列表(只读,迁移后保留不删)               |
| `timemate.pinned.v1`        | v1 置顶 id 列表(同上)                          |
| `timemate.sort-mode.v1`     | v1 排序模式(同上)                              |
| `timemate.hour-format.v1`   | v1 12/24 小时制(同上)                          |
| `timemate.sun.<zone>.<日期>` | **遗留。** 3.1.x 卡片天色用的日出日落缓存(来自 Open-Meteo),每个时区每天一条。天色改为本地计算(§9.2)后不再读写;每次打开 popup 删除全部残留(没有残留时什么也不做)。在 `localStorage`,不经过适配层(§2.3) |

### 3.1 要求

- 入口:`src/main.tsx` 先完成存储初始化(§2.3 的 `init()`),再调用 `migrate()`,等它完成才
  `createRoot().render()`;每次打开 popup 都执行;应用以 `migrate()` 的返回值作为初始数据渲染。
  写成 `init().then(…)`,不用顶层 `await`
- 判定按起始状态区分,见 §3.5:v1 数据从 v1 的 key 迁移;**2.1.0 留下的 v2 数据(条目无 `order`、
  v1 的 key 仍在)从 v1 的 key 重建**;3.0.0 起写入的 v2 数据(有 `order`)只读取
- 写入 v2 之前**必须**把读到的 v1 数据完整备份到 `timemate.backup_v1` 键
  (附 `migratedAt` 时间戳);**该键已存在时不覆盖** —— 包括从 2.1.0 重建时:备份必须保持第一次
  迁移时的 v1 快照
- v1 的 key 只读不删、不改
- 迁移必须幂等:重复执行不产生副作用
- 迁移失败时,保留 v1 数据、不写入、`console.error` 记录,不能让用户看到空列表:返回已映射的
  内存数据(若已算出),否则返回默认数据
- 迁移的每次写入都要确认结果(`flush()`,§2.3),不能只看 `set` 有没有同步抛错 —— Firefox 的写入
  失败是异步的。备份**确认落盘之后**才写 v2:备份写失败则不写 v2,下次打开重新迁移。v2 写失败时,
  适配层已把内存退回原状,存储里不留下写了一半的状态,照样返回已映射的内存数据

### 3.2 映射

v1 的数据分散在四个 key 里,城市条目结构为 `{ id, city, zone, lat?, lon? }`,置顶状态不在条目上,
而是单独存在 `timemate.pinned.v1`(v1 条目 id 的 `string[]`):

```
v1 zone                          →  entry.timezone
v1 city                          →  entry.label(同时记为 entry.defaultLabel)
v1 lat / lon                     →  entry.lat / entry.lon
v1 id ∈ timemate.pinned.v1       →  entry.pinned
timemate.sort-mode.v1            →  settings.sortOrder
    newest → manual,time → offset,alphabet → name
timemate.hour-format.v1          →  settings.hour24('24' → true,'12' → false)
(其余字段填 null / 默认值)
entry.id 新生成(v1 的 id 只用于匹配置顶列表)
```

条目顺序与 v1 存储数组一一对应,随后经过 §3.4 固化为用户当时看到的显示顺序。

**存储格式**:城市列表与置顶列表是 JSON 数组;**排序模式与 12/24 是纯字符串**(`alphabet`、`24`,
不带引号)。所有发布过的 v1(1.0.2–2.1.0)都用 `localStorage.setItem(key, value)` 直接写入、按原样
读回,迁移同样按原样比较,不做 `JSON.parse`。手工构造测试数据时注意:`JSON.stringify('alphabet')`
存进去的是 `"alphabet"`(带引号),那不是 v1 会写出的值。

**缺失与无法识别的值**,回退到 **v1 自己在这种情况下显示的样子**,而不是 v2 的默认值,这样没有人
的界面会在迁移中变样:排序模式回退 `newest`,12/24 回退 12 小时制(v2 新用户的默认是 24 小时制;
全新安装没有任何 v1 的 key,拿到的是 v2 默认值)。

- key **缺失**是正常情况,静默回退
- key **存在但值无法识别**时,必须 `console.warn`(带上原始值)再回退,**不得静默降级** —— 否则
  老用户的设置被无声替换,事后没有任何迹象。与 §3.4「不得回退到原始添加顺序」是同一类保护

### 3.3 验收

用一份真实导出的 v1 数据跑一遍,确认:条目数量一致、顺序一致、置顶状态一致。
**这一步先单独发一个版本上线,不带任何新 UI。** 静默迁移一周,确认没有异常反馈,再开始 v2 界面开发。

### 3.4 固化显示顺序(移除置顶与排序模式)

置顶(`pinned`)与排序模式(`sortOrder`)已移除,手动顺序成为唯一顺序。为了不让老用户
打开后看到列表乱掉,首次读到**没有 `order` 字段**的数据时,`freezeDisplayOrder()` 按旧规则
算出用户当时看到的顺序 —— 置顶项在前,组内按旧 `sortOrder`(manual = 最新在上,即存储数组
倒序;offset = 相对基准时区最落后的在前;name = 字母序)—— 并把该顺序写入 `order`。
这里的 `sortOrder` 是 v2 的取值;v1 用户的 `newest` / `time` / `alphabet` 已在 §3.2 映射成
`manual` / `offset` / `name`,所以 `freezeDisplayOrder()` 只需认 v2 的三个值。

- **不得回退到原始添加顺序**
- 只重排,不删除任何条目
- 只执行一次:之后用户的手动排序不会被旧规则覆盖
- v1 → v2 迁移同样经过这一步
- `pinned` / `sortOrder` 保留在 schema 中标为废弃,因为这一步需要读它们

运行时以 entries 数组顺序为准:保存时把数组下标写入 `order`,读取时按 `order` 排序;
新添加的城市放在最上方。

### 3.5 升级路径

`migrate()` 面对的不是「从零开始」一种情况。**每次改迁移逻辑,都要对照下表逐一测试**(`test/core/migrate.test.ts`
按状态分组),不能只测清空存储后的全新迁移 —— 清空本身就抹掉了真实用户会有的状态,
2.1.0 的问题正是这样漏掉的。

| 起始状态 | 怎么认出来 | 处理 |
| -------- | ---------- | ---- |
| **全新安装** | 没有 `timemate.data.v2`,也没有任何 v1 的 key | v2 默认数据(24 小时制等),不写 `backup_v1` |
| **纯 v1**(从未打开过 2.1.0) | 没有 `timemate.data.v2`,有 v1 的 key | 从 v1 的 key 迁移(§3.2),写 `backup_v1`,固化顺序(§3.4) |
| **2.1.0 产生的 v2** | 有 `timemate.data.v2` 但条目**没有 `order`**,且 v1 的 key 仍在 | **从 v1 的 key 重建**,覆盖这份 v2;`backup_v1` 已存在,不覆盖 |
| **3.0.0 起产生的 v2** | 有 `timemate.data.v2`,条目有 `order` | 只读取,不再碰 v1 的 key |
| **Firefox 全新安装** | `storage.local` 为空 | 同全新安装,默认数据写入 `storage.local` 并确认落盘 |

**为什么 2.1.0 的 v2 必须重建,不能直接用。** 2.1.0 在用户**第一次**打开 popup 时静默跑了一遍迁移,
写下 `timemate.data.v2`;此后 v2 已存在,迁移每次直接返回,v2 再也没有更新过。而 2.1.0 的界面仍是
v1,只读写 v1 的 key。所以用户在 2.1.0 里第一次打开之后做的一切 —— 加城市、删城市、置顶、改排序、
改 12/24、清空列表 —— 都只在 v1 的 key 里。直接用这份 v2,等于把用户退回到第一次打开 2.1.0 的那天。

重建不会丢任何东西:2.1.0 没有 v2 界面,这份 v2 纯粹是从 v1 派生的,用户从没见过、也没改过它。
认法依赖一个事实:`order` 字段在 2.1.0 发布之后才加入,所以任何发布版都不会写出「有 v1 的 key、
v2 却没有 `order`」以外的无 `order` 数据。重建后的 v2 带 `order`,之后就按第 4 种状态只读取 ——
重建只发生一次,用户在 3.0.0 里的改动不会被 v1 的 key 覆盖。

Firefox 版是新上架,之前没有发布过任何 Firefox 版本,所以 `storage.local` 里只会出现「Firefox 全新
安装」和它之后的「3.0.0 起产生的 v2」,不会有 v1 的 key 或 2.1.0 的数据。但迁移逻辑对两个后端是同
一份,前四种状态在 Firefox 后端上同样成立。

测试用的 2.1.0 数据(`test/fixtures/v2-written-by-2.1.0.json`)是用 2.1.0 那个提交(`92aafc3`)自己的
迁移代码生成的,不是手写的;需要新的历史状态时也照此办理。

---

## 4. 时区计算

### 4.1 唯一取偏移的方式

```js
function offsetMinutes(timezone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour % 24,
    +parts.minute,
    +parts.second
  );
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}
```

示例为了可读每次新建 formatter;实现中复用,见 §4.2。

### 4.2 硬性规则

- **偏移必须按具体日期计算,严禁缓存。** DST 切换当天,同一时区上午和下午的偏移不同。
- **禁止缓存的是结果,不是 formatter。** 偏移、本地日期、本地时刻都随 `date` 变化,不得缓存。
  `Intl.DateTimeFormat` 实例只记住时区和要输出的字段,每次调用都按传入的 `date` 重新计算,复用它
  不会让任何结果过期。`core/tz.ts` 按(字段组合, 时区)复用实例:新建一个约 21µs,复用约 1.4µs
  (Chrome 实测),而一次 `coreTime()` 要调用数千次(30 个城市、需要往后找 7 天时约 2.5 万次)。
  **不要把复用 formatter 当成违反上一条而改回每次新建。**
- **不得硬编码任何偏移值。** 不写 `{ 'Asia/Tokyo': 9 }` 这类表。
  - **边界:`src/data/zoneCoordinates.ts` 与 `src/data/zoneLinks.ts` 不属于这类表。** 两者由
    `scripts/build-zone-data.mjs` 从同一版 IANA tzdata **生成**:前者取自 `zone.tab`,只含每个时区代表城市的
    **经纬度**,只用于给没有自身坐标的卡片定太阳位置(§9.2);后者取自 `backward`,只含**名字到名字**的
    映射(见下一条)。都不含任何偏移。文件头记录 tzdata 版本与生成命令,不手改;更新就重新生成。偏移仍然
    一律由 `Intl` 按具体日期计算。
- **时区名:存什么就是什么,比较与交给 `Intl` 时再解析。** 存储的时区名一律不改写 —— 新添加的城市照旧存
  GeoNames 给出的名字(都是 IANA 当前名),已有数据保持原样。同一个时区可能以不同的名字出现:Chrome 把印度的
  系统时区报告为旧名 `Asia/Calcutta`,列表里的城市却是 `Asia/Kolkata`。`core/tz.ts` 的三个函数负责解析:
  - `canonicalZone(tz)`:旧名与合并名 → IANA 当前名(`zoneLinks.ts`)。**`zone.tab` 仍然列出的名字就是当前名,
    不映射** —— `backward` 把 `Africa/Accra`、`Europe/Oslo` 链接到规则相同的 `Africa/Abidjan`、`Europe/Berlin`,
    但那是合并,不是改名,加纳用户的 System chip 应当显示 Accra
  - `sameZone(a, b)`:`canonicalZone(a) === canonicalZone(b)`。**比较两个时区名一律用它,不得用 `===`**
  - `toIntlZone(tz)`:**交给 `Intl` 的时区名一律经过它。** 当前引擎不认新名时(改名晚于引擎的数据,如 2022 年的
    `Europe/Kyiv`),换用它认得的同一时区的旧名 —— 同一时区自 1970 年起规则相同,时刻一样。「名字 → 引擎认得的
    名字」按名字缓存:这是名字解析,与日期无关、在一次会话里不会变,**不是上一条禁止缓存的偏移或本地日期**
  - 显示用的派生名(`friendlyZoneName`)先经 `canonicalZone`:`Asia/Calcutta` 显示为 `Kolkata`
- **粒度为 30 分钟。** 存在 +5:30(印度)、+5:45(尼泊尔)、−3:30(纽芬兰)、+12:45(查塔姆)。所有轴与算法按 48 格处理,不用 24 格。
- **每个条目的本地日期独立计算。** 判断工作日时使用该条目自己的本地 `getDay()`,不能用参考时区的星期。
- **不使用时区缩写。** 界面任何位置都不显示 JST / EST / CST 这类缩写,也不用硬编码映射表补齐。理由有两条:
  1. **无法全局一致。** `Intl` 在 `en-US` 下只对美国时区返回字母缩写(`EDT`、`PDT`),其余多数时区返回 `GMT+8` 这类字符串 —— 连伦敦、柏林、东京都拿不到字母缩写(实测 `timeZoneName: 'short'`)。补齐只能靠映射表,而映射表会随各地政策变化过期,等同于本节禁止的硬编码。
  2. **缩写本身有歧义,会主动误导。** `CST` 可以是美国中部、中国或古巴标准时间;`IST` 可以是印度、爱尔兰或以色列标准时间。显示一个错的缩写,比不显示更糟。

  需要标明时区身份时,一律使用 UTC 偏移(`UTC+09`、`UTC+05:45`),它按具体日期计算、无歧义。

---

## 5. Core Time 算法

### 5.1 输入输出

```js
coreTime({
  entries,        // 完整列表,按列表顺序。只有 includeInCoreTime === true 的条目参与
                  // overlap 与结论;被排除的条目仍各有一行,供面板变暗显示
  settings,
  referenceDate   // 参考时区的某一天
}) → {
  axis: [{ slot, refTime }],        // 48 格
  rows: [{
    entryId,
    included,     // = includeInCoreTime
    offToday,     // 该条目在 referenceDate 这一刻不在自己的 workDays 内(见 5.3)
    blocks,       // 48 个布尔:该槽位是否为工作槽
    localDate,
    crossesDay
  }],
  overlap: [{ startSlot, endSlot }] | [],   // 参与条目的交集
  conclusion:                        // 状态枚举 + 数据,不含文案,见 5.3
    | { status: 'NO_ENTRIES' }
    | { status: 'OVERLAP' }
    | { status: 'PARTIAL_OVERLAP', overlap, includedIds, excludedId }
    | { status: 'NO_OVERLAP_TODAY', closest: {
          slot, refTime,
          perEntry: [{ entryId, localTime, deviationMinutes, direction }],
                    // direction: 'BEFORE_START' | 'AFTER_END' | null(在工作时段内)
          gapMinutes,             // 该槽位上最大的单个偏离量,恒 > 0
          bottleneckEntryIds      // 偏离量等于 gapMinutes 的全部条目,列表顺序
      } }
    | { status: 'ALL_OFF', offEntryIds, nextOverlap: { daysFromToday, weekday, startSlot, endSlot, excludedId } | null }
                    // excludedId: 那一天去一法排除的条目;全员重叠时为 null
    | { status: 'PARTIAL_OFF', workingEntryIds, offEntryIds, workingOverlap: [...] | [], nextOverlap: {...} | null }
                    // 这里的 nextOverlap 只找全员重叠,excludedId 恒为 null
}
```

### 5.2 逻辑

1. 以参考时区的当日 00:00 为起点,生成 48 个 30 分钟槽位
2. 对每个条目、每个槽位:换算成该条目的本地时刻与本地星期
3. 该槽位计入工作时段,当且仅当:本地星期 ∈ `workDays` 且本地时刻 ∈ `[start, end)`。
   **这是系统内「工作时间」的唯一定义**:色带的工作块、`overlap`、`closest` 的偏离量都由同一个
   函数(`workWindowPosition`)得出,槽位是工作槽 ⇔ 它的偏离量为 0。曾经两处各写一份边界判断,
   `closest` 把恰好落在 `end` 上的槽位算作偏离 0,而 `overlap` 认为它不在工作时段内
4. `overlap` = 所有参与条目工作槽位的交集
5. `overlap` 为空时,进入 5.3 的状态判断——不再直接计算 `closest`,是否计算 `closest` 本身取决于该状态判断的结果

### 5.3 空状态是主状态,不是异常

东京 + 波士顿在默认工时下**必然**零重叠。这是最常见的情况,必须给出可操作的结果,而不是一句「计算失败」类的兜底文案。零重叠之外,「今天恰好是休息日」同样是常态而非异常,需要单独识别,不能和「工时对不上」混成一种状态。城市一多,全员交集为空更是常态 —— 所以还要识别「只差一个城市」。

**任何展示 Core Time 状态的元素都必须读同一份判断结果,不得自行计算。** 判断只在
`core/coretime.ts` 里做一次:`conclusion`,加上每行的 `included` / `offToday` / `blocks`。
结论行、色带、行标签(Off 标签)、closest 标记线、时间列,以及展开态与收起态,全部只读这份
结果;UI 缺什么数据,就在 core 的返回值里加字段,不在渲染层补算。判断只返回状态枚举 + 该状态
需要的数据,不含任何文案字符串,文案全部由 UI 层渲染。

> 这条约束最初只写了「展开态与收起态共用同一个状态判断」,但平行计算会换个位置出现:
> 色带上的 Off 标签曾按「整条轴上没有工作槽」自行判断,结论行则按 `referenceDate` 这一刻的
> 本地星期判断。轴擦到另一天的工时时两者就不一致 —— 周一上午的东京轴上,22:00–23:30 是
> 波士顿周一 09:00–10:30,结论说「只有 4 个城市在上班」,展开的色带上波士顿却没有 Off 标签。
> 现在两者都读 `rows[].offToday`,`offEntryIds` 也由它得出。

按下表**自上而下**判断状态:

| 状态               | 触发条件                                                    | 数据                                                |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| `NO_ENTRIES`       | 参与计算的条目数为 0(包括全部被用户排除);也是下方计算异常时的统一兜底 | —                                                    |
| `OVERLAP`          | `overlap` 非空                                                | `overlap` 数组                                       |
| `ALL_OFF`          | `overlap` 为空,且所有参与条目在 `referenceDate` 这一刻都不在各自 `workDays` 内 | 休息条目 id 列表、`nextOverlap`                       |
| `PARTIAL_OFF`      | `overlap` 为空,部分(非全部)参与条目在 `referenceDate` 这一刻不在各自 `workDays` 内 | 在岗条目 id 列表、休息条目 id 列表、`workingOverlap`、`nextOverlap` |
| `PARTIAL_OVERLAP`  | `overlap` 为空,所有参与条目今天都在工作日,且**恰好一个**条目被排除后其余条目的 `overlap` 非空;至少 3 个参与条目 | 子集的 `overlap`、`includedIds`、`excludedId`       |
| `NO_OVERLAP_TODAY` | 以上都不满足:所有参与条目今天都在工作日,工时对不上,且没有唯一的离群条目 | `closest`                                            |

`PARTIAL_OFF` 先于 `PARTIAL_OVERLAP`:有人今天休息是 `workDays` 的问题,不是工时离群,两者不混用。

**判断"今天是否在场"用的是 `referenceDate` 这一个具体瞬间的本地星期,不是扫描整条 48 槽轴。** 扫描整条轴会产生两种边界假象:(a) 一个与参考时区零偏移的条目,它在轴上的本地星期是恒定值,一旦当天不是它的工作日,会让轴上全部 48 个槽位都判定为不可行,`closest` 因此直接返回 `null`;(b) 一个有偏移的条目,轴的两端可能分别落在两个不同日历日,恰好把前一天工作日的一小段划进轴内,产出「周六 00:00」这类没有实际意义的建议。改成只看 `referenceDate` 这一个瞬间,这两种假象都不会出现。这个结果按行暴露为 `rows[].offToday`。

**`PARTIAL_OVERLAP`(去一法)**:依次排除一个参与条目,计算其余条目的 `overlap`。恰好一个排除能产生
非空 `overlap` 时返回该状态;多个排除都能产生(没有唯一的离群者),或没有任何一个能产生(不是一个
城市的问题)时,落到 `NO_OVERLAP_TODAY`。**不做「最大可行子集」搜索**:子集数量随城市数指数增长,
规则也无法向用户一句话解释;去一法覆盖真实场景中最常见的「一个离群时区」。至少 3 个参与条目:
两个城市时,「除了 X 都重叠」只是另一个城市自己的工时,没有信息量。

**`PARTIAL_OFF` 的 `workingOverlap`**:在岗条目今天自己的交集,与 `nextOverlap`(下一次**全员**
重叠)并列返回。周一上午的东京,波士顿还是周日 —— 亚洲几个城市今天就能凑上,只说「下次全员重叠」
会把今天可用的窗口藏起来。少于 2 个在岗条目,或在岗条目之间也对不上时为空数组。

**`NO_OVERLAP_TODAY` 的 `closest`**:

- **偏离量**:条目在工作时段内为 0;早于 `start` 时为 `start − 本地时刻`(会议开始得有多早);
  晚于或等于 `end` 时为 `本地时刻 + 30 − end`(一格长的会议超出 `end` 多少)。因此恰好从
  `end` 开始的槽位偏离 30 分钟而非 0 —— `end` 本身不在 `[start, end)` 内。偏离量按条目的实际
  本地时刻计算,不对齐到网格:加德满都(+5:45)的本地时刻落在 :15 / :45,在工作时段内时严格为 0。
- **选槽位**:所有参与条目偏离量**之和**最小的槽位;并列取最早。**并列取最早是刻意保留的**:
  并列区间内,最早的槽位通常把不便算在使用者自己头上(东京 + 波士顿:06:30 让你早起 2.5 小时,
  而不是让波士顿晚睡)。工具替使用者承担,比替同事做决定更得体,用户随时可以自己还价。曾考虑
  以「最大偏离量最小」作第二排序键(更平均),未采用。已知缺陷见 §13。
- **返回**:槽位与时刻、每个条目的本地时刻 / 偏离量 / 方向、`gapMinutes`(该槽位上最大的单个
  偏离量,即瓶颈的偏离;恒 > 0,若为 0 则所有条目都在工作,应为 `OVERLAP`)、
  `bottleneckEntryIds`(偏离量等于 `gapMinutes` 的全部条目)。
- **提示文案**用最大偏离量,指向瓶颈:单一瓶颈时点名并给方向(`4.5h before Boston's day starts` /
  `2h after Boston's day ends`;瓶颈是基准城市时说 `your day`)。**并列时给数量和小时数,不点名**
  (`2 cities are 3.5h outside their work hours`):只点名一个会让用户以为排除它就能解决,实际不会;
  小时数说明指的是偏离最大的那几个,而不是所有不在工作时间的城市。
- 这个分支的前提是当天所有条目都在工作日内,正常情况下必然有解;若仍返回 `null`(例如日期变更线
  两侧的极端偏移组合),视为 bug:`console.error` 并回退到 `NO_ENTRIES`,不再新增第二套「计算失败」文案。

**`ALL_OFF` / `PARTIAL_OFF` 的 `nextOverlap`**:从明天起,以参考时区的日历日为单位向后逐日搜索——每天各自生成一条完整的 48 槽轴并计算 `overlap`(与当天的算法完全一致),取第一个 `overlap` 非空的日期,返回该日期的星期与时段。上限 7 天;超出上限仍未找到则返回 `null`,UI 不渲染这一行,而不是再补一句兜底文案。

**`ALL_OFF` 的逐日搜索带去一法**:某天全员 `overlap` 为空时,对当天的行套用与 `PARTIAL_OVERLAP`
完全相同的规则(恰好一个条目被排除后其余非空;至少 3 个参与条目),成立就采用这一天,并在
`excludedId` 返回被排除的条目;全员重叠时 `excludedId` 为 `null`。**逐日判断,取最早的一天**:
某天只能「除 X 外」重叠,而更晚的某天全员重叠时,返回的是更早那天的「除 X 外」。两者都不成立
的日子跳过;7 天都不成立时仍为 `null`,不渲染。理由与 `PARTIAL_OVERLAP` 相同:城市一多,全员
交集在未来 7 天内几乎必然为空,只找全员重叠的 `nextOverlap` 会恒为 `null` —— 10 个分散全球的
城市在周日只剩一句 `Everyone's off today`,没有任何可操作的信息。

**`PARTIAL_OFF` 的 `nextOverlap` 仍只找全员重叠**(文案 `Next full overlap`),不套用去一法。
`PARTIAL_OFF` 已经用 `workingOverlap` 给出今天可用的子集;而今天休息的那个城市,通常正是之后
各天的离群者 —— 周一上午的东京加波士顿,去一法给出的是「周二,除波士顿外」,只是把
`workingOverlap` 换个日期重复一遍。

文案示例(UI 层渲染,`core/` 本身不含任何文案字符串):

```
OVERLAP            Overlap 11:00–18:00
PARTIAL_OVERLAP    All but Boston overlap 12:30–18:00
                   Boston is outside its work hours — tap to exclude it
  (离群者是你)     All but you overlap 12:30–18:00
                   Your hours don't overlap — tap to exclude yourself
NO_OVERLAP_TODAY   No overlap today
                   Closest — 17:30 yours
                   4.5h before Boston's day starts
  (瓶颈并列)       2 cities are 3.5h outside their work hours
ALL_OFF            Everyone's off today
                   Next overlap — Mon 11:00–18:00
  (那天有离群者)   Next overlap — Mon 11:00–18:00 (all but Boston)
  (离群者是你)     Next overlap — Mon 11:00–18:00 (all but you)
PARTIAL_OFF        Only 4 cities are working today
                   Those 4 overlap 12:30–18:00
                   Next full overlap — Tue 11:00–18:00
  (1–2 个在岗)     Only Shanghai and Tokyo are working today
                   They overlap 10:00–18:00
NO_ENTRIES         Add a city to compare
  (全部被排除)     No cities in core time
                   Tap a city to include it        (收起态:Expand to include a city)
```

`PARTIAL_OVERLAP` 的第二行本身就是按钮,见 §9.3。3 个以上在岗城市用计数,1–2 个用名字 —— 少数时
名字比数字清楚。

### 5.4 单条目

只有一个条目时,`overlap` 就是该条目的工作时段本身,不算异常,正常渲染。

该条目的工作时段跨过参考时区的午夜时,轴上是**两段**,两段都完整列出,按轴上从左到右的顺序:
基准东京、只有波士顿时为 `Boston 00:00–07:00, 22:00–24:00` —— 前一段是波士顿**前一天**下午
(11:00–18:00),后一段是波士顿当天上午(09:00–11:00)。不用 `+1 more`:它不说明省略了什么,
而这里没有什么该省略。多段的情况不限于单条目,`OVERLAP` / `PARTIAL_OVERLAP` / `PARTIAL_OFF` 的
时段一律全部列出;结论行允许换行,时段整体不拆开,不做截断。

---

## 6. DST 预警

### 6.1 检测

对每个条目,从今天起逐日取该时区**本地 12:00**,计算偏移,发现相邻两日偏移不同即为切换日。同时对**参考时区自身**做同样检测。

前瞻天数取 `settings.dstLeadDays`(默认 14)。

### 6.2 文案

以「你」为主语,描述关系变化,不描述时区政策:

```
In 9 days (Nov 1), Boston shifts to EST.
Your gap: 13 hours → 14 hours
Your 16:00 slot becomes 17:00 for Kenji.
```

必须处理的两种情况:

- **单边切换**:参考时区(如东京)不实行 DST,但对方切换。用户什么都没做,时差自己变了 —— 文案要明确「变的是对方」。
- **南半球方向相反**:悉尼在 10 月往前调。禁止写死「退一小时」。

### 6.3 呈现层次

1. 卡片行角标(被动)
2. popup 顶部横幅,进入 `dstLeadDays` 窗口后显示(主动)
3. 系统通知 —— 需要 `notifications` 权限,**默认关闭**,在设置页明示会请求额外权限

第 3 层第一版不做。

**权限约束(第 3 层实现时必须遵守)**:

- `notifications` 只能声明在 manifest 的 `optional_permissions` 中,在用户打开该设置开关时
  通过 `chrome.permissions.request()` 运行时申请。
- **不得**加入 `permissions` 字段。新增必需权限会让 Chrome 在更新时禁用扩展、要求全体用户
  重新授权,而该功能默认关闭、多数用户不会使用,为它让所有人承担被禁用(进而卸载)的风险不划算。
- Chrome 版的 manifest 不声明任何权限(`permissions` / `optional_permissions` /
  `host_permissions` 均无)。这是商店页面上的信任优势 —— 新增任何权限(包括可选权限)前,
  都应先评估必要性。
- Firefox 版只声明 `storage`(§2.3)。它不产生用户可见的警告;Firefox 版是全新上架,也不存在
  「更新时因新增权限被禁用」的问题。
- **扩展不发出任何网络请求。** 天色本地计算(§9.2),城市库、国旗、字体都打包在扩展里(§9.6),
  所以不需要 `host_permissions`,Firefox 的 `data_collection_permissions` 是 `{ required: ["none"] }`。
  `npm run check:offline`(每次构建都跑)扫描两个产物:白名单(`scripts/check-offline.mjs`:
  用户自己点开的商店 / 网站 / 反馈表单 / GeoNames 链接、许可证文本里的链接、不会被请求的 XML 命名空间名)
  以外出现任何 http(s) URL,或出现 Vite modulepreload polyfill 之外的 `fetch` / XHR / `sendBeacon` /
  WebSocket,构建即失败。新功能需要联网时,先改这里

### 6.4 调度

第 1、2 层在 popup 打开时随渲染计算,不需要任何调度。只有后台的周期性检测(第 3 层系统通知)
需要定时:

- **必须使用 `chrome.alarms`**。不得使用 `setTimeout` / `setInterval` —— service worker 空闲约
  30 秒就会被挂起,计时器随之消失;也不得使用 `requestAnimationFrame` —— service worker 里没有它,
  页面里它在后台标签页也不触发。
- alarm 在浏览器重启后不保证保留:在 `runtime.onInstalled` 与 `runtime.onStartup` 中检查并按需
  重建(与 `background.js` 现在设置卸载问卷链接的方式相同)。
- `chrome.alarms` 需要 `alarms` 权限。它不产生用户可见的警告,不会触发更新时的重新授权,但会结束
  「manifest 不声明任何权限」的现状 —— 按 §6.3 先评估。
- Chrome 的 service worker 读不到 `localStorage`,后台检测拿不到城市列表;前提是 Chrome 后端先换成
  `chrome.storage.local`,见 §13。Firefox 的数据已在 `storage.local`(§2.3),后台可以直接读。

---

## 7. 人物模式(推迟)

本版不实现。数据字段已在 §2.1 保留。

下一版的设计约束记录在此,避免遗忘:头像只用姓名首字母 + 纯色圆底,不做图片上传;`person.color` 取自固定调色板;分组只做名称 + 成员,无嵌套。

### 7.1 状态推导(本版可选实现)

以下判定逻辑**不依赖 `person`**,仅依赖 `workHours` / `workDays`,在 §5 完成后基本零成本:

```
weekend   本地星期 ∉ workDays
working   本地时刻 ∈ workHours
asleep    本地时刻 ∈ [23:00, 07:00)
off-hours 其余
```

`asleep` 用固定时段判定,**不是** `workHours` 之外。下班和睡觉是两回事。

若本版实现,仅在卡片底部信息行以一个状态点 + 单词呈现,不新增布局层级。是否加入由实现时判断,不做硬性要求。

---

## 8. 免费 / Pro 边界

|                | 免费                  | Pro                 |
| -------------- | --------------------- | ------------------- |
| 城市时钟       | 最多 30 个            | 同                  |
| Core Time 面板 | 可见可用,统一默认工时 | 自定义工时 + 周视图 |
| DST 预警       | —                     | 全部                |
| 设置页         | 全部可见可进入        | 同                  |

城市上限是 `core/model.ts` 的 `MAX_CITIES = 30`,免费与 Pro 相同。**凡是能让列表变长的地方都检查
同一个上限**(`hasRoomForCity()`):

- **添加**:满 30 个时第 31 个被拒绝,搜索框提示 `You can add up to 30 cities`(文案里的数字取自
  `MAX_CITIES`,不写死)
- **Undo**:放回会超出上限时 —— 满员时删一个、5 秒内又加一个 —— toast 只显示 `Removed X`,不再
  提供 Undo,删除即生效。不留一个点了没反应的按钮
- **读取**:打开 popup 时,超出上限的部分被截掉(保留列表顶部的 30 个,`console.warn` 记录),
  随后照常写回。任何版本写入的数据都不超过 11 个(3.0.0 的上限是 10,Undo 不检查时最多到 11),
  所以这一步只防手工改动或将来的降级,不会删掉真实用户的城市

**3.0.0 的上限是 10,来历不明。** 它来自 `4f4f7d1`(2026-03-01,v1 发布前),commit message 只有
"add 10-city limit",没有说明。当时 Core Time 面板与基准 chip 的下拉都还不存在,所以它不是为
这两处定的。

**当时真正的约束是 Core Time 色带没有自己的滚动。** 展开后面板高约 119 + 17.8n px(结论两行时),
540px 的 popup 去掉头部与边距后只剩约 436px 给面板:约 17 行时列表区被压到 0,再多,结论行就
被挤出 popup(3.0.0 实测:20 个城市超出 23px,30 个完全看不见)。`PARTIAL_OVERLAP` 的「点此
排除」按钮就在结论行上,被挤出后点不到。Chrome 的 popup 最高 600px,加高也只能多放约 3 行。
3.1.0 让色带在 10 行后自己滚动(§9.3),这条约束随之消失,上限提高到 30。基准 chip 的下拉(§9.1)
不构成约束:它在 10 个城市时就已经需要滚动。30 个城市时打开 popup 的首帧约 39ms(复用 formatter
之后,§4.2;之前是 521ms)。

人物模式推迟后,Pro 的内容为:**按条目自定义工作时间 / 工作日、Core Time 周视图、DST 预警**。

### 8.1 实现约定

**权限判断只有一个入口:**

```js
// src/pro/entitlement.js
export async function isPro() { ... }
```

开发期通过环境开关强制返回 `true`,ExtPay 在最后一步接入,替换该函数内部实现,不改任何调用点。

### 8.2 UI 规则

- Pro 功能**不灰掉、不加锁图标**,点击后进入升级页
- 设置页中 Pro 分区加 `PRO` 标签,标签是信息不是障碍。**但本版不显示该标签** —— 还没有购买
  通道,标签会让用户以为这是当下可买的功能。下一版接入付费时加回,届时用中性样式(深灰底 +
  浅灰字),不用紫色
- Core Time 面板对免费用户完整渲染,每行下标注 `9:00–18:00 · default`,点击该处触发升级提示

### 8.3 离线降级

`isPro()` 依赖网络。结果缓存在 `storage.local`,网络失败时沿用缓存,宽限期 7 天。
**fail-open**:宁可漏掉少数未付费用户,不能把已付费用户锁在门外。

---

## 9. UI 结构

### 9.1 头部

头部左侧是一个基准时区 chip:`[logo 22px][城市名][HH:MM][⌄]`。时刻取自
`settings.referenceTimezone`(为 `null` 时取系统时区)。

**城市名的优先级**:

- **选了 System(`referenceTimezone` 为 `null`)时,一律用系统时区 IANA id 派生的名称**
  (先换成 IANA 当前名,再取 `/` 后半段,`_` 替换为空格:`Asia/Tokyo` → `Tokyo`,Chrome 报告的
  `Asia/Calcutta` → `Kolkata`,§4.2),**不匹配任何条目的 label** ——
  即使列表里有同一时区的条目。否则列表里有 Tsu(`Asia/Tokyo`)时,选 System 后 chip 仍显示
  `Tsu`,和选 Tsu 看起来完全一样,用户得不到选择已生效的反馈。
- **只有用户选了某个条目时,才显示该条目的 `label`**:按 `settings.referenceEntryId` 找到用户选的
  那一个,而不是「该时区的第一个条目」—— Boston 与 New York 同为 `America/New_York`,只存时区
  就分不出选的是谁。
- 选中的条目被删除后:回退到列表中同一时区剩下的第一个条目,再回退到 IANA id 派生的名称。
  `referenceEntryId` 不随删除清空,Undo 放回后名称随之恢复。没有 `referenceEntryId` 的旧数据
  同样按时区取第一个条目,与改动前一致。

判定写在 `core/model.ts` 的 `resolveReferenceChip()`(纯函数,有单测),返回名称与选中项。

**本节与 §9.2、§9.3 里的「同一时区」「属于系统时区」一律按 `sameZone()` 判定**(§4.2):旧名与当前名是同一个
时区。系统时区报告为 `Asia/Calcutta`、列表里是 Kolkata(`Asia/Kolkata`)时,Kolkata 就是系统时区的条目 ——
标 `YOU`、卡片显示 `Base`。添加城市时「同名 + 同时区视为重复」同样按 `sameZone()`。

System 与同时区条目并不等价:System 跟随电脑的时区(出差时会变),选条目则固定在该时区。

点击展开一个下拉列表:「System timezone」(副标题为系统时区的派生名),分隔线下**列出全部条目,
不按时区去重** —— 用户按城市名认条目,自己添加的城市在下拉里消失会被当成 bug。下拉最高
240px(完整可见约 6 项),超出滚动 —— 10 个城市时就已经需要滚动;不需要分组。选条目时同时保存其时区
(`referenceTimezone`)与 id(`referenceEntryId`);选 System 时两者都清为 `null`。当前选中项蓝底
高亮,并以 `aria-pressed` 标记。

**身份与关系跟随不同的值,这是有意设计,不是不一致**:

- **身份 —— 「哪一个是我」**:chip 的名称、Core Time 色带的 `YOU` 标签(§9.3),以及结论里
  代替城市名的 `you`(`All but you overlap`、`(all but you)`)。都由 `resolveReferenceChip()` 一处
  判定:选了条目时是那个条目(`referenceEntryId`,被删除时回退到同时区剩下的第一个条目);选
  System 时是列表中第一个属于系统时区的条目,没有这样的条目就没有 `YOU`。**同一时刻至多一个**。
  选 System 时 chip 的名称仍是系统时区的派生名(见上):chip 回答「选了哪个选项」,`YOU` 回答
  「列表里哪一行是我」—— System 下两者可以不同(chip `Tokyo`,色带上 `Tsu` 标 `YOU`)。
- **关系 —— 「这一行与基准差多少」**:卡片的 `Base`(§9.2)、色带的 `BASE` 标签(§9.3),以及
  描述基准时刻的 `your` / `yours`(`Closest — 17:30 yours`、`before your day starts`)。跟随
  `referenceTimezone`。基准为 New York 时,Boston 同样是 `Base`:两者零时差,只标其中一个会让
  用户以为它们之间有区别。

**`YOU` 曾经也跟随时区**(3.0.0),同时区的两个条目于是都显示 `YOU`。逻辑上说得通,渲染出来却像
bug:`YOU` 是第一人称,天然唯一,出现两次只会被理解成出错。`Base` 出现两次不会:它描述的是关系,
不是身份。所以 3.1.0 起 `YOU` 改为跟随选中项,`Base` 维持跟随时区。不要把 `Base` 改成跟随选中
项,也不要把 chip 名称或 `YOU` 改回跟随时区。

**3.1.0 选 System 时没有 `YOU`**,自己的城市显示 `BASE`。而基准默认就是 System,于是绝大多数用户
在色带上完全看不到 `YOU` —— 它的作用是让用户在色带上找到自己,默认状态下看不到就是功能回退。
3.1.1 起 System 下的 `YOU` 标在系统时区的第一个条目上。

选定后,下方城市列表与 Core Time 轴据此立即重算(两者本来就读
`settings.referenceTimezone`,切换后自动生效,无需额外联动代码)。chip 背景与头部其它
按钮相同(`--color-primary`,悬停 `--color-hover`),**不随基准城市的昼夜变色**。它曾复用卡片的
天空渐变,在 `245f1a1` 中有意移除,当时的理由是设计上的:与 `+` / 转换 / 设置按钮一致,而不是一个
整天变色、在按钮行里格外显眼的胶囊。事后实测还有一条技术理由,**不要加回**:chip 上是白字,
白字在白天与黎明的天色上只有 1.6–3.8:1(白天 `#3d83e5 / #74b6e6 / #b2d0f0` 为 3.8 / 2.2 / 1.6,
黎明 3.5 / 2.6 / 1.6),全部低于 12–13px 文字需要的 4.5:1;现在的 `--color-primary` 上是 14.0:1。

右侧精简为三个动作:`+ 添加` / `⏱ 时间转换` / `⚙ 设置`。
`12/24` 移入设置页,原胶囊整体删除(排序已整体移除,见 §3.4)。

原 logo 点击弹出的 Share / Rate / Feedback 菜单已移除 —— logo 的点击目标现在是上述
基准时区 chip。该菜单的内容迁移到设置页的 About 分区,见 §9.4。

### 9.2 卡片

- 高度压缩至 60–64px(当前约 86px)。底部面板会占去约 140px,不压缩则 540px 高度下仅能露出 4 张卡片
- 本版不实现头像列。但卡片内部布局请预留左侧插入一列的余地,避免下一版重写
- 保留天空渐变背景 —— 这是产品的核心视觉资产
- **圆角**:`border-radius: 22px` + `corner-shape: squircle`(编辑模式的单行卡片是 16px + squircle)。
  浏览器不支持 `corner-shape` 时(Firefox;Chrome 139 之前)**不模拟 squircle**,退化为普通圆角
  `border-radius: 16px`:同样 22px,普通圆弧比 squircle 圆得多,16px 看起来最接近。单行卡片本来就是
  16px,退化时不变。只用 `@supports not (corner-shape: squircle)` 实现,支持的浏览器渲染完全不变
- **天色由卡片所示时刻、该城市的太阳高度角决定**(`core/sun.ts`,NOAA 算法,本地计算,不联网):
  高度角低于 **−9°** 为 `night`,高于 **+7°** 为 `day`,介于两者之间时,太阳正午之前为 `dawn`、之后为
  `twilight`(太阳正午按经度逐日计算)。这两个阈值由 3.1.2 的「日出/日落 ±45 分钟」窗口换算而来:
  在 Tokyo、London、New York、Sydney、Singapore 的二分二至日、每 15 分钟一个采样上,每个分界都落在
  3.1.2 的一个采样之内;London 的两个至日,黎明与黄昏比 3.1.2 各长约 30 分钟(两个采样)。**这不是误差,
  是新模型更接近真实**:纬度越高,太阳升落的角度越斜,穿过同一段高度角要更久,真实的曙暮光本来就更长;
  3.1.2 的 ±45 分钟在任何纬度都一样长,那才是近似。极昼、极夜不需要特殊处理:太阳只是一直不越过某个阈值(极昼没有 `night`,极夜没有
  `day`,正午前后的微光是 `dawn` / `twilight`)
  - 转换模式下按转换器选定的时刻计算
  - 坐标:条目自己的 `lat`/`lon`(0 是合法坐标,不是缺失);没有时(2.0.0 之前添加的城市)用 tzdata
    `zone.tab` 中该时区代表城市的坐标(§4.2);时区没有地理位置(如 `Etc/GMT-9`)时取赤道、按其 UTC
    偏移对应的经度。推导出的坐标只在运行时使用,不写回用户数据
  - 四种天色之间的切换沿用 CSS 的颜色过渡(`@property` 注册的 `--tz-c0/1/2`,0.6s),没有按高度角插值
- 秒数默认关闭
- **点击卡片打开该城市的设置面板**(城市名可编辑,改过名时输入框左侧出现重置按钮,恢复为添加时的
  名字 `defaultLabel`;工作时间 / 工作日只读,标 `default`,
  点击后给出提示:`Custom work hours are coming in the next update. For now, every city
  uses the defaults in Settings.` —— 其中 `Settings` 可点击,直接打开设置页并定位到 Core time
  分区(看到这句话的人正想去改那个默认值);`Remove this city` 为红色破坏性样式)。原「悬停齿轮 → 横滑露出
  置顶 / 删除」菜单及其首次提示动画已移除,置顶一并移除(§3.4)。手势总表见 §9.5
- 删除没有二次确认,立即生效,底部弹出 `Removed Bangkok · Undo`(约 5 秒),Undo 放回原位置。
  放回会超出城市上限时只显示 `Removed Bangkok`,没有 Undo(§8)

**底部信息栏**

```
左:相对差值(主) + UTC 偏移(次)        右:[yesterday / tomorrow |] 星期 | 日期

Base   UTC+09                            TUE | 22 SEP    ← 基准时区对应的条目
−13h   UTC−04                yesterday | MON | 21 SEP    (仅说明为纯白)
+5h    UTC+14                 tomorrow | WED | 23 SEP

−25h   UTC−11              2 days back | SUN | 14 JUN
       ↑ 基准为 Kiritimati(TUE 16 JUN 00:30)时的 Niue:跨日期变更线相差两日
```

- **左侧以基准时区为参照。** 基准即头部 chip 的 `settings.referenceTimezone`(`null` 取系统时区)。
  差值由 `core/tz.ts` 的 `relativeOffsetMinutes()` 计算,取卡片**当前显示的那一刻**(转换模式下即
  转换器所选时刻),不缓存 —— DST 期间同一对城市的差值会变(§4.2)。UI 层只负责渲染。
- **格式**:整点 `+2h` / `−13h`;非整点写成 `+3:30h` / `+5:45h`,不用小数。
- 与基准时区 **IANA id 相同**的条目显示 `Base`,不显示 `+0h`。id 不同但此刻偏移恰好相同的条目
  (如首尔 vs 东京)显示 `0h` —— 两者在 DST 期间可能分开,不能冒充基准。
- **`Base` 跟随基准时区,不跟随 chip 中选中的条目。** 同一时区的条目都显示 `Base`:基准为 New York
  时 Boston 也是 `Base`。`Base` 表达的是这一行与基准的时差(关系),两者零时差;chip 的名称表达的
  是选了哪个城市(身份)。两者跟随不同的值是有意设计,见 §9.1。
- **`Base` 可以出现多次,Core Time 的 `YOU` 不行**(§9.3)。`Base` 是关系,两个城市都与基准零时差,
  标两次正确且不引起误解;`YOU` 是第一人称的身份,只能有一个。卡片上不用 `YOU`。
- **UTC 偏移保留,降为次级**(更小、更暗):`UTC+09` / `UTC−04` / `UTC+05:45`,零偏移为 `UTC`。
  它是无歧义的可信度锚点,不删除。不显示时区缩写(§4.2)。
- **右侧星期 + 日期对所有条目照常显示**,不做「仅在与基准不同日时显示」的条件隐藏,**颜色也始终不变**。
  条目本地日期与基准时区日期不同(`localDayDelta() ≠ 0`)时,在星期**之前**加一段说明,与星期之间用和
  「星期 | 日期」相同的细分隔线隔开:相差 ±1 日写 `yesterday` / `tomorrow`;跨日期变更线相差 ±2 日
  (`Pacific/Kiritimati` vs `Pacific/Niue`)写 `2 days back` / `2 days ahead`。
  **这段说明是唯一被强调的元素** —— 日期与星期不重新着色,两条分隔线保持白色。
- **强调方式是纯白、不带透明度**,四种天色统一,不用任何色相。底栏其余文字是 85% 白,说明本身是
  100% 白 —— 差别很轻,但这是唯一需要的区分。之所以不用颜色:卡片背景是四种天色渐变,任何单一
  色相都做不到全适配(浅蓝在白天与黎明卡片上只有 1.1–1.3:1,深蓝在夜晚卡片上只有 1.5:1),而按
  天色切换色值会让同一个含义在不同卡片上呈现成不同颜色。

### 9.3 Core Time 面板

底部常驻,非 tab。收起时只显示结论行,展开显示色带。进入编辑模式时收起,退出时展开(行序
跟随列表,刚排好的顺序直接可见)。面板上所有元素只读 `coreTime()` 的结果,见 §5.3。

**头部**:`Core time` + `today · 5 cities`;有条目被排除时为 `today · 4 of 5 cities`。点击展开/
收起。全部条目都被排除时仍可展开 —— 色带是把城市加回来的地方。

**城市列表为空时面板照常显示**(除非设置为 Hide):结论为 `NO_ENTRIES` 的 `Add a city to compare`,
头部为 `today · 0 cities`,没有色带可展开。这是新用户的第一屏,面板不能缺席。

**设置为 Hide 时不计算 `coreTime()`**,而不只是不渲染 —— 没人看的结论不该占用打开 popup 的第一帧。

**色带**:每个条目一行,顺序同列表,**包括被排除的条目**。轴为参考时区当天 0–24 点,蓝色块是
该条目的工作槽(`rows[].blocks`)。

- 重叠区用橙色框标出,只画在参与该重叠的行上:`OVERLAP` 画全员 `overlap`,`PARTIAL_OVERLAP`
  与 `PARTIAL_OFF` 画子集的 overlap。被排除的行不画
- **`YOU` 与 `BASE` 标签**(§9.1):代表使用者的那一个条目标 `YOU` —— 身份,至多一个;基准时区
  里的其他条目标 `BASE` —— 关系,可以有多个,与卡片的 `Base` 同一个词、同一个含义。`YOU` 由
  `resolveReferenceChip()` 的 `youEntryId` 给出,与头部 chip 同一份判断:
  - 选了条目:就是那个条目(被删除时回退到同时区剩下的第一个)
  - 选 System(默认):列表中第一个属于系统时区的条目;同时区的其他条目标 `BASE`
  - 没有条目属于基准时区:没有 `YOU`,也没有 `BASE`

  城市名的基准蓝色跟随关系,这些行都是蓝色。结论里代替城市名的 `you`
  (`All but you overlap`、`(all but you)`)与 `YOU` 标签是同一个判断,只指 `YOU` 那一行。
  曾经两行都标 `YOU`(同为 `Asia/Tokyo`),被当成 bug —— 见 §9.1

**色带最多显示 10 行,超出在色带内部滚动**:

- 滚动容器只包色带网格。头部与结论行在容器外,**结论行始终可见** —— `PARTIAL_OVERLAP` 的「点此
  排除」按钮在结论行上。3.0.0 的色带没有滚动,面板高约 119 + 17.8n px,20 个城市时结论行就被挤出
  popup(§8)
- 最大高度 = 恰好 10 行:行高是 12px 城市名 × 1.15 行高 = 13.8px,加 4px 行距,再加上边距与刻度行,
  约 210px。10 个及以下与 3.0.0 相同(上边距多 2px,见下),第 11 个起滚动。展开态面板最高约
  300px,popup 里的列表仍能露出一张多卡片
- 刻度行(0 6 12 18 24)用 `position: sticky; bottom: 0` 固定在滚动区底部,留在网格里(subgrid),
  不移出:城市名那一列按最长的名字自适应宽度,移出网格就与色带对不齐
- `overscroll-behavior: contain`:滚到底不带动下面的城市列表
- 刻度行上方有一道底部渐隐,与城市列表底部是同一个渐变(`--color-bg-info` → 透明),提示下面还有
  行;随滚动淡出,滚到底时消失,不能滚动时不出现
- closest 竖线跨越全部行,随内容一起滚动。上边距从 4px 改为 6px,竖线顶端的圆点才不会被滚动容器
  裁掉
- 今天休息的行(`rows[].offToday`):`Off` 标签,色带 45%
- 被用户排除的行:名称加删除线,色带 25%。**不隐藏** —— 用户需要记得排除过谁,也要能点回来

**点击交互**:

- **点色带左侧的城市名** → 切换该条目的 `includeInCoreTime`,立即持久化。城市名是按钮
  (`aria-pressed` 表示是否参与)
- **`PARTIAL_OVERLAP` 的提示行**(`… — tap to exclude it`)本身就是按钮,点击即排除离群条目。
  收起态没有城市名可点,提示必须自己能用;它同时承担「点城市名可以排除」这一交互的可发现性
- 全部排除 → `NO_ENTRIES`,文案改为 `No cities in core time` + `Expand to include a city`(收起)/
  `Tap a city to include it`(展开)

**closest 的展示(`NO_OVERLAP_TODAY`)**:

- 收起态只给基准时刻和提示:`Closest — 17:30 yours` + 瓶颈提示(§5.3)。不逐城市列出本地时刻 ——
  5 个城市就会换行三次,10 个会挤满面板
- 展开态:**一条竖线在 closest 槽位穿过所有行**,谁在自己的工作时段内、谁在外,一眼可见,不需要
  读数字;这是这个展示的核心。第三列补充各城市在该时刻的本地时间,瓶颈条目加粗(并列时全部
  加粗)。竖线取槽位中点,避免恰好落在某行色块的边缘、看不出在内还是在外。时间列按最宽值自适应
  (11px 加粗的 `05:30` 约 28px),不写死宽度

**颜色**:

- **橙色(`--color-secondary`)只保留给本面板的重叠框**,含义是「这段时间所有人都行」。界面其它
  位置一律不用 —— 它曾同时表示置顶、分区标题、搜索匹配、日出、转换器角标等无关语义,已全部换掉
- closest 竖线用**中性白** + 顶端圆点,不用橙色:closest 按定义不是所有人都行;而且重叠框在色带上
  被裁成每行两道短橙线,一道橙色竖线会被读成一个很窄的重叠区。竖线是一个元素贯穿所有行,
  不是每行一截 —— 这是它和重叠框在视觉重量上的区别:框是区域,线是单点
- 时间列的强调靠字重,不靠色相(与卡片底栏的日期说明同一原则,§9.2)
- 色带底色为转换器渐变(`--gradient-converter`),工作块为 `#5c7cd6`

**可读性**:变暗的行(休息或被排除)名称仍是按钮,必须可读。统一为中性白 50%,在面板底色
`#202025` 上 5.1:1,满足 12px 文字的 AA(4.5:1)—— 这是硬线,不为视觉偏好让步(实测:25% 为
2.3:1,35% 为 3.2:1,45% 为 4.4:1)。行内的 `YOU` / `BASE` / `Off` 标签不再叠加额外透明度(叠加后曾低至
2.4:1);删除线用文字颜色,同为 5.1:1。基准城市的蓝色在 50% 时只有 3.1:1,所以变暗的行统一
改用中性色,`YOU` / `BASE` 标签仍标明是谁。休息与排除靠 `Off` 标签 vs 删除线、色带 45% vs 25% 区分,
不靠文字亮度。

**`YOU` / `BASE` 标签的底色**(3.1.2,9px + `--color-bg-info` 底色):对比度相对标签底色计算。
实测正常行 5.36:1,变暗行(休息或排除)4.65:1,都过 AA 4.5:1,但变暗行只剩 0.15 的余量 —— 底色
本身把文字对比度拉低了(无底色时为 6.24:1 / 5.06:1),再加深底色或再调暗文字就会跌破硬线。底色对
面板只有 1.16:1(变暗行 1.09:1),达不到非文本对比度 3:1。这是有意保留的:标签的含义完全由文字
承担,底色是装饰,不属于 WCAG 1.4.11 要求 3:1 的「理解内容所必需的图形」。改动标签样式时,重新
按底色测一遍文字对比度。

### 9.4 设置页

popup 内滑入式面板,不开新标签页。导航深度不超过两层。

当前已实现的分区,按顺序:

- **Display** — Hour format / Show seconds / Edit city list(进入编辑模式,§9.5;
  原 Sort order 已移除,不提供一次性排序按钮)
- **Core time** — Core Time panel 显示模式 / Default work hours / Default work days
- **About**(本版新增,不在最初的分区规划内)— Share Skies(复制**本浏览器**的商店链接。
  剪贴板确认写入成功后,按钮文案才短暂变为 "Copied!";写入失败(没有剪贴板、被拒绝等)时同样时长显示
  "Couldn't copy" —— 不显示没有发生的复制)/ Rate(Chrome 版 `Rate on Chrome Web Store`,打开商店的 reviews 页;
  Firefox 版 `Rate on Firefox Add-ons`,打开 https://addons.mozilla.org/firefox/addon/skies-world-clock/ ,
  AMO 在商品页本身打分。两个版本的链接与文案按 `__TARGET__` 在编译期选定,各自的包里只有自己的)/
  Send Feedback / Website
  (右侧灰字 `useskies.com`,打开 https://useskies.com;行文案用 "Website" 而非品牌名)/ Version
  (读取 `package.json` 的版本号,而非写死字符串)/ Recent updates(见下)/ City data(About 分区的
  最后一行:`GeoNames (CC BY 4.0)`,`GeoNames` 链接到 https://www.geonames.org/,`CC BY 4.0` 链接到
  许可证,行尾箭头出框图标;这是城市库的 CC BY 4.0 署名,见 §9.6 与 `ATTRIBUTION.md`)。这里收纳的是原头部
  logo 弹出菜单的内容。行尾图标按动作区分:离开扩展的外链用「箭头出框」,Share 是复制到剪贴板、
  用复制图标(复制后短暂变成勾),`›` 只留给 popup 内部的跳转(如 Edit city list)。

**Recent updates**(3.1.1 起):在 About 卡片里、紧接 Version 行之下 —— 它说的就是这个版本变了什么,
所以跟着 Version,不单独成一个分区。City data 在它之后,是 About 的最后一行,上方有一条分隔线。

```
Version                      v3.1.1
───────────────────────────────────
Recent updates
· Up to 30 cities (was 10)
· Core Time is much faster
───────────────────────────────────
City data       GeoNames (CC BY 4.0) ↗
```

写法约定。前两条是这个区块可信度的前提 —— 用户会拿它对照自己的使用,对不上一次,以后就不再读:

- **只描述变了什么,不评价好坏。** 写能被验证的事实:`Up to 30 cities (was 10)`。不写「全新」
  「更好用」「更强大」这类评价,不用 NEW 标签或感叹号
- **只保留 2–3 条。** 发新版本时替换旧条目,不累积。它是「最近」,不是 changelog;条目一多就没人读。
  `test/components/recentUpdates.test.ts` 把条数卡在 2–3,加第 4 条会让测试失败,逼着先删旧的
- **纯静态。** 条目硬编码在 `src/components/recentUpdates.ts`,不从 changelog 生成;不做展开收起、
  「已读」状态、徽章或红点
- **视觉权重低于设置项。** 11px、次级灰(不透明度 50%,与 Version 的值相同),没有行分隔线、
  没有悬停或点击态。它是记录,不是公告

**DST alerts** 与 **Account** 两个分区仍未实现,分别等待构建顺序(§11)第 7、8 步
(`dst.js` 检测与横幅、接入 ExtPay)完成后再加入。注意 **About ≠ Account**:About 是
产品信息与反馈入口(本节新增),Account 届时用于订阅与权益相关设置(见 §8),两者
用途不同,不要合并成一个分区。

(People 分区下一版加入)

### 9.5 编辑模式与手势分配

**入口**:设置页 Display 分区的 `Edit city list`。不做长按入口。

**编辑态**:
- 头部换成 `Edit list` + `Done`
- 每张卡片左右缩进:左侧 24px 圆形红色减号,右侧常驻抓手
- 卡片简化为单行 —— 城市名 + 时间,不显示底栏。popup 宽度减去两侧操作区后内容区仅约
  320px,底栏会过挤;单行也让行更矮、同屏可见更多城市
- **保留天空渐变**,用户靠颜色辨认卡片
- Core Time 面板自动收起;退出编辑模式时展开并重算一次

**交互**:
- 拖动抓手排序,不需要长按
- 点减号直接删除,弹出 `Removed X · Undo`,不做两步确认
- 点卡片本身无行为
- `Done` 或点击列表外空白区域退出;删光最后一个城市时也自动退出(Undo 仍可用)

**实现要求**:
- 使用 **dnd-kit**。不用 HTML5 原生 drag-and-drop API,不用已停止维护的 react-beautiful-dnd
- 启用键盘操作:聚焦抓手,空格拾起,方向键移动,空格放下,Esc 取消;读屏播报使用城市名而非 id
- 拖到可视区域边缘时列表自动滚动(popup 仅 540px 高,约 6 个城市即需滚动)
- 尺寸未变的 window `resize` 不取消拖拽:Firefox 的 popup 在 DOM 变化后会重新量尺寸,
  即使大小没变也触发 `resize`。Esc、`pointercancel`、页面隐藏、尺寸真的变了,照旧取消
- 顺序变更后立即持久化
- **Core Time 面板的行顺序与列表顺序一致**(两者都按 entries 数组顺序)

**手势总表** —— 每个手势只对应一个行为,不得重叠或遗留:

| 模式 | 手势       | 行为             |
| ---- | ---------- | ---------------- |
| 普通 | 点击卡片   | 打开该城市设置   |
| 普通 | 长按卡片   | 无(本版不实现) |
| 普通 | 横滑       | 已移除           |
| 编辑 | 拖抓手     | 排序             |
| 编辑 | 点减号     | 删除 + Undo      |
| 编辑 | 点卡片     | 无               |


### 9.6 城市搜索

- **数据在扩展里,不联网。** 城市库 `src/data/cities.ts` 由 `scripts/build-cities.mjs` 从 GeoNames 的公开数据
  (cities15000、alternateNamesV2、admin1CodesASCII、countryInfo)生成,文件头记录数据日期与生成命令;
  生成的文件提交进仓库,构建时不下载任何东西(AMO 的复现构建不能依赖网络)。GeoNames 为 CC BY 4.0,
  署名见 §9.4 与 `ATTRIBUTION.md`
- **收录**:人口 ≥ 50,000 或国家首都;排除城区(GeoNames 地物代码 `PPLX`)。显示名为 GeoNames 的英文首选名
  (没有时用 GeoNames 名称,如 `New York` 而非 `New York City`);另收供搜索的别名:GeoNames 名称与 ASCII
  名、中文(各地区变体)、日文,以及英文旧名(`Bangalore`、`Calcutta`、`Kiev`、`Saigon`)。**不收俗称**
  (否则 `New York` 会搜到雅加达的 `New York Van Java`)
- **只在打开搜索时加载**:城市库是单独的 chunk,由搜索框挂载时动态 `import()`,不进 popup 首帧;加载完成前
  显示 `Searching…`。之后每次按键在本地查询,不防抖
- **匹配**:不区分大小写、变音符号与标点(`Sao Paulo` = `São Paulo`,全角字母同半角)。精确匹配(任一名称
  与输入相同)排在前缀匹配之前,同级按人口从大到小;最多 8 条(与原先 Open-Meteo 的 `count=8` 相同)。
  同名且同时区的城市只显示一条 —— 与添加时「同名 + 同时区视为重复」一致
- **写入条目的字段不变**:`timezone`、`label`(城市名)、`lat`、`lon`,与原先从 Open-Meteo 得到的相同;
  条目 `id` 仍由 `createEntry()` 生成(UUID),与 GeoNames id 无关 —— 原先也从未使用 Open-Meteo 返回的 id
- 没有结果时显示:`No match. Try a nearby larger city — you can rename it after adding.`
- **国旗也在扩展里**:flagcdn.com 的 80px 宽 PNG(全部国家代码,`public/flags/<代码>.png`,由
  `scripts/fetch-flags.mjs` 更新),以 32px 宽、高度按比例显示,与原先加载 flagcdn 的 SVG 同尺寸

---

## 10. 测试用例

计算模块必须是纯函数、无 DOM 依赖、可独立单测。

### 10.1 DST 边界

| 日期       | 场景                                        |
| ---------- | ------------------------------------------- |
| 2026-03-08 | 美国进入 DST                                |
| 2026-11-01 | 美国退出 DST                                |
| 2026-03-29 | 欧洲进入 DST                                |
| 2026-10-04 | 澳大利亚进入 DST(南半球,方向相反)           |
| 任意       | 东京 vs 柏林 —— 单边切换,东京不变但时差变化 |

### 10.2 半小时 / 15 分钟时区

`Asia/Kolkata` (+5:30) / `Asia/Kathmandu` (+5:45) / `Pacific/Chatham` (+12:45) / `America/St_Johns` (−3:30)

### 10.3 日期变更线

`Pacific/Kiritimati` (+14) vs `Pacific/Niue` (−11) —— 相差 25 小时,轴上必然跨两日。

### 10.4 业务用例

- Tokyo + Boston,默认工时 → `overlap` 为空,`closest` 非空(06:30 JST;两个城市不判 `PARTIAL_OVERLAP`)
- Tokyo + Singapore + Berlin,默认工时 → `overlap` = 16:00–18:00 JST
- 单条目 → `overlap` = 自身工作时段
- 全部条目 `includeInCoreTime: false` → `NO_ENTRIES`,不报错,`rows` 仍逐条返回
- 某条目 `workDays` 为空数组 → 该条目永不参与,`overlap` 为空
- Shanghai / Boston / Tokyo / Kathmandu / Bangkok,基准东京,周五 → `PARTIAL_OVERLAP`,排除 Boston,
  子集 overlap = 12:30–18:00 JST(加德满都的第一个工作槽是当地 09:15)
- 同上再加 New York → 没有唯一离群者,`NO_OVERLAP_TODAY`;closest = 18:30,不落在任何条目的
  `end` 上;Boston 与 New York 并列瓶颈(210 分钟);加德满都偏离严格为 0
- 同上五城市,周一上午的东京(波士顿仍是周日)→ `PARTIAL_OFF`,`workingOverlap` = 12:30–18:00;
  波士顿的 `offToday` 为 true,尽管轴末端擦到它周一的工作槽
- 某条目今天休息、其余条目可以重叠 → `PARTIAL_OFF`,不是 `PARTIAL_OVERLAP`
- Tokyo / Seoul / Shanghai / New York,基准东京,周日 → `ALL_OFF`,`nextOverlap` = 周一
  10:00–18:00,`excludedId` 为 New York;两个东亚 + 两个美国城市 → 没有唯一离群者,`nextOverlap` 为 `null`
- 周一只有一个条目不上班、周二全员重叠 → `ALL_OFF` 的 `nextOverlap` 取周一(除它外),不是周二
- `closest` 的任一条目:偏离量为 0 ⇔ 该槽位是它的工作块

### 10.5 迁移

真实 v1 数据 → 条目数、顺序、置顶状态一致;重复执行结果不变。

按 §3.5 的四种起始状态分别覆盖:

- 全新安装 → v2 默认值(24 小时制),不写 `backup_v1`
- 纯 v1,三种排序模式各一遍(`newest` / `time` / `alphabet`,按 v1 的纯字符串格式写入)
- 2.1.0 产生的 v2,v1 的 key 在第一次打开之后:什么都没改(最常见)/ 加过城市 / 删过城市 /
  改过排序模式 / 改过 12/24 / 清空了列表 —— 结果都以 v1 的 key 为准;`backup_v1` 保持 2.1.0
  写下的原样;v1 的 key 不被修改
- 3.0.0 产生的 v2 → 只读取;重建之后用户在 3.0.0 里的改动,不会被仍然存在的 v1 key 覆盖
- 无法识别的排序模式 / 12/24 值 → `console.warn` 带原始值,回退到 v1 的默认
- Firefox 全新安装(`storage.local` 为空)→ v2 默认值,经 Firefox 后端写入并确认落盘
- 写入失败:备份写失败 → 不写 v2;v2 写失败 → 存储里没有半成品,仍返回已映射的列表

### 10.6 天色

- 太阳高度角对照 Open-Meteo:10 座城市非极地日子的日出、日落时刻,几何高度角都在 −0.83° 附近
- 天色对照 3.1.2:5 座城市 × 二分二至,见 §9.2 的允许误差;基准时间线由 3.1.2 自己的 `timeOfDay` 加
  Open-Meteo 的日出日落生成(`test/fixtures/sky-3.1.2.json`),不是手写的
- 极昼、极夜、日落过午夜(Tromsø、Reykjavík)
- 坐标回退:自身坐标(含 0)、`zone.tab`、`backward` 旧名、无地理位置的时区

### 10.7 存储适配层

- Firefox 后端:写入按调用顺序完成;写入失败时 `console.error`、`flush()` reject、内存退回存储里
  已确认的值;`init()` 读入 `storage.local` 的全部内容;任何一串操作之后内存与存储一致;`init()`
  失败时只读,存储不被改动
- Chrome 回归:同一份 v2 数据经新代码读取、修改、保存,写出的字符串与 3.1.2 逐字节一致。比较基准
  用 3.1.2(`d5ff25d`)自己的代码生成,不是手写的(同 §3.5 的 2.1.0 数据)

---

## 11. 构建顺序

每一步独立可验证,不合并。

1. **数据模型 + 迁移**(含保留字段),用真实 v1 数据测试 → **单独发版上线,不含新 UI**
2. `tz.js` 偏移计算 + 单测(第 10.1–10.3 节)
3. `coretime.js` 交集算法 + 单测(第 10.4 节)
4. Core Time 面板渲染 + 零重叠空状态
5. 卡片压缩 + 头部精简 + 滑动菜单整理(删除按钮改红色)
6. 设置页
7. `dst.js` 检测 + 横幅
8. 接入 ExtPay,替换 `isPro()` 实现
9. 截图 → 落地页

第 8 步放最后:先让功能在自己环境跑一周,确认计算无误再收费。付费墙后面藏一个算错时间的功能,退款成本远高于晚上线一周。

下一版:人物模式 + 分组 + Core Time 周视图。推迟的项目与理由见 §13。

---

## 12. 目录结构建议

```
src/
  core/
    store.js        KeyValueStore 接口(core 访问存储的唯一方式)
    model.js        v2 schema、默认值、resolveWorkHours
    migrate.js      v1 → v2
    tz.js           偏移、本地时刻、本地星期
    coretime.js     交集与 closest
    dst.js          切换检测
  platform/
    storage/        KeyValueStore 的后端:localStorage(Chrome)、storage.local(Firefox),§2.3
  ui/
    popup.js
    card.js
    coretime-panel.js
    settings/
  pro/
    entitlement.js  isPro() 唯一入口
test/
  fixtures/
    v1-real.json    真实 v1 导出数据
```

`core/` 只能通过注入的 `KeyValueStore` 访问存储,不得直接引用 `localStorage`、`chrome.*`、`browser.*` 或任何 DOM API。平台相关的实现放在 `platform/`,由入口(`main.tsx`)注入。

---

## 13. Backlog

已决定推迟的项目,连同理由一起记下,避免下次重新推演。

| 项目 | 推迟到 | 理由 |
| ---- | ------ | ---- |
| 人物模式 + 分组 | 下一版 | 改动列表主体结构(头像列、分组层级),不适合和 Core Time 同版上线。数据字段已在 §2.1 保留,不需要再迁移 |
| Core Time 周视图 | 随付费通道 | Pro 功能(§8),没有购买通道前不做 |
| 多语言 EN / JA / ZH | 界面文案稳定后 | 文案还在改,现在抽 JSON 只会反复改两遍。注意:`chrome.i18n` 按浏览器语言读 `_locales`,**无法在运行时切换**;要在应用内切换语言,需要自建一层 |
| Chrome 后端 `localStorage` → `chrome.storage.local` | 与 DST 版本一起 | service worker 读不到 `localStorage`,DST 后台检测(§6.4)需要它。适配层已经就位(§2.3),届时只需换 Chrome 的后端,再做一次数据搬迁(备份、幂等、失败不写入,同 §3.1),和 DST 一起做只迁一次。那次迁移同样要对照 §3.5 的全部起始状态,外加「已在 chrome.storage」这一种。Firefox 从第一版起就在 `storage.local`,不需要搬 |
| ExtPay 接入 | 付费通道上线时 | §8.1 约定 `isPro()` 为唯一入口,但**它目前还不存在**:代码里没有任何 Pro 判断,Pro 功能(按城市自定义工时 / 工作日)只以只读 + "coming in the next update" 呈现。接入时先按 §8.1 建立 `isPro()`,再在它内部接 ExtPay,调用点只认 `isPro()` |
| closest:基准时区不在城市列表里时 | 下一版 | 并列取最早是刻意保留的(§5.3),但它依赖使用者自己作为条目参与计算。基准时区不是任何条目时(例如用系统时区而没添加自己的城市),没有任何东西惩罚使用者的深夜,closest 可能给出凌晨的建议;基准 chip 可以自由切换后,这种情况更容易出现。**修法方向**:把基准时区的默认工时也纳入偏离计算,无论它是否作为条目存在 —— 开会的人总是在场的。本版不改 |

### 13.1 案例:同一份判断被多处消费

**Off 标签 bug(v3.0.0 开发中发现并修复)。** Core Time 的状态判断同时被结论行、色带、行标签、
closest 标记线、时间列消费。色带上的 Off 标签曾自己算「今天是否休息」(整条轴上没有工作槽),
结论行则按 §5.3 的规则算(`referenceDate` 这一刻的本地星期)。两种算法在轴擦到另一天的工时时
给出不同答案,于是同一个面板上,结论说「只有 4 个城市在上班」,色带上的波士顿却没有 Off 标签。

教训:**状态判断被多处消费时,任何一处自行计算都会产生不一致**,哪怕那处的算法单独看起来是对的。
下次加新的展示元素时,只读 `coreTime()` 返回的字段;缺数据就在 core 的返回值里加字段(`offToday`
就是这样加的),不在 UI 里补算。规则见 §5.3。
