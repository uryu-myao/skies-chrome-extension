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
    referenceTimezone: null,   // null = 使用系统时区
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

---

## 3. 迁移 v1 → v2

**所有 storage key 保留 `timemate.` 前缀,改名后不得变更**(产品已从 TimeMate 两次改名,现为 Skies)。
key 是老用户数据所在的位置,改一个字就等于让所有老用户的城市消失。扩展 ID 同理:`localStorage`
按扩展的 origin(`chrome-extension://<ID>/`)隔离,ID 变了,旧数据同样读不到。

存储全部在 popup 页的 `localStorage`,不使用 `chrome.storage`:

| key                         | 内容                                             |
| --------------------------- | ------------------------------------------------ |
| `timemate.data.v2`          | v2 数据(§2.1)                                   |
| `timemate.backup_v1`        | 迁移前的 v1 快照,只写一次                        |
| `timemate.timezones.v1`     | v1 城市列表(只读,迁移后保留不删)               |
| `timemate.pinned.v1`        | v1 置顶 id 列表(同上)                          |
| `timemate.sort-mode.v1`     | v1 排序模式(同上)                              |
| `timemate.hour-format.v1`   | v1 12/24 小时制(同上)                          |
| `timemate.sun.<zone>.<日期>` | 卡片天色用的日出日落缓存,每个时区每天一条        |

### 3.1 要求

- 入口:`src/main.tsx` 在 `createRoot().render()` 之前同步调用 `migrate()`,每次打开 popup 都执行;
  应用以 `migrate()` 的返回值作为初始数据渲染
- 判定:`timemate.data.v2` 不存在(或不是有效的 v2 数据)即从 v1 的 key 读取并迁移;
  已有 v2 数据时只读取,外加一次性的 `freezeDisplayOrder()`(§3.4)
- 写入 v2 之前**必须**把读到的 v1 数据完整备份到 `localStorage` 的 `timemate.backup_v1` 键
  (附 `migratedAt` 时间戳);该键已存在时不覆盖
- v1 的 key 只读不删、不改
- 迁移必须幂等:重复执行不产生副作用
- 迁移失败时,保留 v1 数据、不写入、`console.error` 记录,不能让用户看到空列表:返回已映射的
  内存数据(若已算出),否则返回默认数据

### 3.2 映射

v1 的数据分散在四个 key 里,城市条目结构为 `{ id, city, zone, lat?, lon? }`,置顶状态不在条目上,
而是单独存在 `timemate.pinned.v1`(v1 条目 id 的 `string[]`):

```
v1 zone                          →  entry.timezone
v1 city                          →  entry.label(同时记为 entry.defaultLabel)
v1 lat / lon                     →  entry.lat / entry.lon
v1 id ∈ timemate.pinned.v1       →  entry.pinned
timemate.sort-mode.v1            →  settings.sortOrder
    newest → manual,time → offset,alphabet → name;缺失或无效 → 默认值
timemate.hour-format.v1          →  settings.hour24('24' → true,'12' → false;缺失 → 默认值)
(其余字段填 null / 默认值)
entry.id 新生成(v1 的 id 只用于匹配置顶列表)
```

条目顺序与 v1 存储数组一一对应,随后经过 §3.4 固化为用户当时看到的显示顺序。

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

### 4.2 硬性规则

- **偏移必须按具体日期计算,严禁缓存。** DST 切换当天,同一时区上午和下午的偏移不同。
- **不得硬编码任何偏移值。** 不写 `{ 'Asia/Tokyo': 9 }` 这类表。
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
    | { status: 'ALL_OFF', offEntryIds, nextOverlap: { daysFromToday, weekday, startSlot, endSlot } | null }
    | { status: 'PARTIAL_OFF', workingEntryIds, offEntryIds, workingOverlap: [...] | [], nextOverlap: {...} | null }
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
- 当前版本的 manifest 不声明任何权限(`permissions` / `optional_permissions` /
  `host_permissions` 均无)。这是商店页面上的信任优势 —— 新增任何权限(包括可选权限)前,
  都应先评估必要性。

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
- service worker 读不到 `localStorage`,后台检测拿不到城市列表。前提是存储先迁到
  `chrome.storage`,见 §13。

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
| 城市时钟       | 无数量限制            | 同                  |
| Core Time 面板 | 可见可用,统一默认工时 | 自定义工时 + 周视图 |
| DST 预警       | —                     | 全部                |
| 设置页         | 全部可见可进入        | 同                  |

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

头部左侧是一个基准时区 chip:`[logo 22px][城市名][HH:MM][⌄]`。城市名与时刻取自
`settings.referenceTimezone`(为 `null` 时取系统时区);若该时区恰好匹配某个已添加
条目,取该条目的 `label`,否则从 IANA id 派生一个可读名(取 `/` 后半段,`_` 替换为空格)。
点击展开一个下拉列表,可选「System timezone」或任一已添加条目的时区(按 timezone 去重)
作为新的基准;下方城市列表与 Core Time 轴据此立即重算(两者本来就读
`settings.referenceTimezone`,切换后自动生效,无需额外联动代码)。chip 背景色随该
基准城市当前的昼夜状态变化,复用卡片已有的天空渐变色板(`--tz-c0/-c1/-c2`,
`night / dawn / day / twilight` 四态),不引入新配色。

右侧精简为三个动作:`+ 添加` / `⏱ 时间转换` / `⚙ 设置`。
`12/24` 移入设置页,原胶囊整体删除(排序已整体移除,见 §3.4)。

原 logo 点击弹出的 Share / Rate / Feedback 菜单已移除 —— logo 的点击目标现在是上述
基准时区 chip。该菜单的内容迁移到设置页的 About 分区,见 §9.4。

### 9.2 卡片

- 高度压缩至 60–64px(当前约 86px)。底部面板会占去约 140px,不压缩则 540px 高度下仅能露出 4 张卡片
- 本版不实现头像列。但卡片内部布局请预留左侧插入一列的余地,避免下一版重写
- 保留天空渐变背景 —— 这是产品的核心视觉资产
- 秒数默认关闭
- **点击卡片打开该城市的设置面板**(城市名可编辑,改过名时输入框左侧出现重置按钮,恢复为添加时的
  名字 `defaultLabel`;工作时间 / 工作日只读,标 `default`,
  点击后给出提示:`Custom work hours are coming in the next update. For now, every city
  uses the defaults in Settings.` —— 其中 `Settings` 可点击,直接打开设置页并定位到 Core time
  分区(看到这句话的人正想去改那个默认值);`Remove this city` 为红色破坏性样式)。原「悬停齿轮 → 横滑露出
  置顶 / 删除」菜单及其首次提示动画已移除,置顶一并移除(§3.4)。手势总表见 §9.5
- 删除没有二次确认,立即生效,底部弹出 `Removed Bangkok · Undo`(约 5 秒),Undo 放回原位置

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

**色带**:每个条目一行,顺序同列表,**包括被排除的条目**。轴为参考时区当天 0–24 点,蓝色块是
该条目的工作槽(`rows[].blocks`)。

- 重叠区用橙色框标出,只画在参与该重叠的行上:`OVERLAP` 画全员 `overlap`,`PARTIAL_OVERLAP`
  与 `PARTIAL_OFF` 画子集的 overlap。被排除的行不画
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
2.3:1,35% 为 3.2:1,45% 为 4.4:1)。行内的 `YOU` / `Off` 标签不再叠加额外透明度(叠加后曾低至
2.4:1);删除线用文字颜色,同为 5.1:1。基准城市的蓝色在 50% 时只有 3.1:1,所以变暗的行统一
改用中性色,`YOU` 标签仍标明是谁。休息与排除靠 `Off` 标签 vs 删除线、色带 45% vs 25% 区分,
不靠文字亮度。

### 9.4 设置页

popup 内滑入式面板,不开新标签页。导航深度不超过两层。

当前已实现的分区,按顺序:

- **Display** — Hour format / Show seconds / Edit city list(进入编辑模式,§9.5;
  原 Sort order 已移除,不提供一次性排序按钮)
- **Core time** — Core Time panel 显示模式 / Default work hours / Default work days
- **About**(本版新增,不在最初的分区规划内)— Share Skies(复制商店链接,
  按钮文案短暂变为 "Copied!")/ Rate on Chrome Store / Send Feedback / Website
  (右侧灰字 `useskies.com`,打开 https://useskies.com;行文案用 "Website" 而非品牌名)/ Version
  (读取 `package.json` 的版本号,而非写死字符串)。这里收纳的是原头部 logo 弹出
  菜单的内容。行尾图标按动作区分:离开扩展的外链用「箭头出框」,Share 是复制到剪贴板、
  用复制图标(复制后短暂变成勾),`›` 只留给 popup 内部的跳转(如 Edit city list)。

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
- `closest` 的任一条目:偏离量为 0 ⇔ 该槽位是它的工作块

### 10.5 迁移

真实 v1 数据 → 条目数、顺序、置顶状态一致;重复执行结果不变。

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
    model.js        v2 schema、默认值、resolveWorkHours
    migrate.js      v1 → v2
    tz.js           偏移、本地时刻、本地星期
    coretime.js     交集与 closest
    dst.js          切换检测
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

`core/` 下所有模块不得引用 `chrome.*` 或 DOM。

---

## 13. Backlog

已决定推迟的项目,连同理由一起记下,避免下次重新推演。

| 项目 | 推迟到 | 理由 |
| ---- | ------ | ---- |
| 人物模式 + 分组 | 下一版 | 改动列表主体结构(头像列、分组层级),不适合和 Core Time 同版上线。数据字段已在 §2.1 保留,不需要再迁移 |
| Core Time 周视图 | 随付费通道 | Pro 功能(§8),没有购买通道前不做 |
| 多语言 EN / JA / ZH | 界面文案稳定后 | 文案还在改,现在抽 JSON 只会反复改两遍。注意:`chrome.i18n` 按浏览器语言读 `_locales`,**无法在运行时切换**;要在应用内切换语言,需要自建一层 |
| `localStorage` → `chrome.storage` | 与 DST 版本一起 | service worker 读不到 `localStorage`,DST 后台检测(§6.4)需要它。`storage` 权限不产生用户可见的警告,但换存储意味着又一次数据迁移(备份、幂等、失败不写入,同 §3.1),和 DST 一起做只迁一次 |
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
