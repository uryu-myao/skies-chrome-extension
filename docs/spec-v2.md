# TimeMate v2 — 功能规格

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
      label: "Berlin",         // 显示名,默认取城市名
      person: null,            // 【本版保留不用】{ name, initials, color, note }
      workHours: null,         // 或 { start: 9, end: 18 },null = 用全局默认
      workDays: null,          // 或 [1,2,3,4,5],null = 用全局默认
      includeInCoreTime: true,
      pinned: false,
      groups: []               // 【本版保留不用】group id 数组
    }
  ],
  groups: [],                  // 【本版保留不用】{ id, name }
  settings: {
    hour24: true,
    showSeconds: false,
    sortOrder: "manual",       // manual | offset | name
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

### 3.1 要求

- 入口:扩展启动时,读取 storage 后立即执行,早于任何渲染
- 判定:`data.version` 缺失或 < 2 即执行迁移
- 迁移前**必须**把原始 v1 数据完整备份到 `storage.local` 的 `backup_v1` 键
- 迁移必须幂等:重复执行不产生副作用
- 迁移失败时,保留 v1 数据、不写入、上报错误,不能让用户看到空列表

### 3.2 映射

```
v1 city.timezone  →  entry.timezone
v1 city.name      →  entry.label
v1 city.pinned    →  entry.pinned
(其余字段填 null / 默认值)
entry.id 新生成
```

### 3.3 验收

用一份真实导出的 v1 数据跑一遍,确认:条目数量一致、顺序一致、置顶状态一致。
**这一步先单独发一个版本上线,不带任何新 UI。** 静默迁移一周,确认没有异常反馈,再开始 v2 界面开发。

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
  entries,        // 仅 includeInCoreTime === true 的条目
  settings,
  referenceDate   // 参考时区的某一天
}) → {
  axis: [{ slot, refTime }],        // 48 格
  rows: [{ entryId, blocks, localDate, crossesDay }],
  overlap: [{ startSlot, endSlot }] | [],
  conclusion:                        // 状态枚举 + 数据,不含文案,见 5.3
    | { status: 'NO_ENTRIES' }
    | { status: 'OVERLAP' }
    | { status: 'NO_OVERLAP_TODAY', closest: { refTime, perEntry: [...], gapMinutes } }
    | { status: 'ALL_OFF', offEntryIds, nextOverlap: { daysFromToday, weekday, startSlot, endSlot } | null }
    | { status: 'PARTIAL_OFF', workingEntryIds, offEntryIds, nextOverlap: {...} | null }
}
```

### 5.2 逻辑

1. 以参考时区的当日 00:00 为起点,生成 48 个 30 分钟槽位
2. 对每个条目、每个槽位:换算成该条目的本地时刻与本地星期
3. 该槽位计入工作时段,当且仅当:本地星期 ∈ `workDays` 且本地时刻 ∈ `[start, end)`
4. `overlap` = 所有条目工作槽位的交集
5. `overlap` 为空时,进入 5.3 的状态判断——不再直接计算 `closest`,是否计算 `closest` 本身取决于该状态判断的结果

### 5.3 空状态是主状态,不是异常

东京 + 波士顿在默认工时下**必然**零重叠。这是最常见的情况,必须给出可操作的结果,而不是一句「计算失败」类的兜底文案。零重叠之外,「今天恰好是休息日」同样是常态而非异常,需要单独识别,不能和「工时对不上」混成一种状态。

`overlap` 为空时,按下表判断状态。**展开态与收起态渲染必须共用同一个状态判断,不允许两套逻辑**;判断本身放在 `core/coretime.ts`,只返回状态枚举 + 该状态需要的数据,不含任何文案字符串,文案全部由 UI 层渲染:

| 状态               | 触发条件                                                    | 数据                                                |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| `NO_ENTRIES`       | 参与计算的条目数为 0;也是下方计算异常时的统一兜底             | —                                                    |
| `OVERLAP`          | `overlap` 非空                                                | `overlap` 数组                                       |
| `ALL_OFF`          | `overlap` 为空,且所有条目在 `referenceDate` 这一刻都不在各自 `workDays` 内 | 被排除条目 id 列表、`nextOverlap`                     |
| `PARTIAL_OFF`      | `overlap` 为空,部分(非全部)条目在 `referenceDate` 这一刻不在各自 `workDays` 内 | 在岗条目 id 列表、被排除条目 id 列表、`nextOverlap`   |
| `NO_OVERLAP_TODAY` | `overlap` 为空,且所有条目在 `referenceDate` 这一刻都在各自 `workDays` 内 | `closest`                                            |

**判断"今天是否在场"用的是 `referenceDate` 这一个具体瞬间的本地星期,不是扫描整条 48 槽轴。** 扫描整条轴会产生两种边界假象:(a) 一个与参考时区零偏移的条目,它在轴上的本地星期是恒定值,一旦当天不是它的工作日,会让轴上全部 48 个槽位都判定为不可行,`closest` 因此直接返回 `null`;(b) 一个有偏移的条目,轴的两端可能分别落在两个不同日历日,恰好把前一天工作日的一小段划进轴内,产出「周六 00:00」这类没有实际意义的建议。改成只看 `referenceDate` 这一个瞬间,这两种假象都不会出现。

**`NO_OVERLAP_TODAY` 的 `closest`**:在参考轴上找一个槽位,使得**所有条目距离各自工作时段的总偏离分钟数最小**。返回该时刻、各条目的本地时刻、以及最大偏离量(用于生成「4h after your day ends」这类提示)。若存在多个并列最优解,取最早的一个。这个分支的前提是当天所有条目都在工作日内,正常情况下必然有解;若仍返回 `null`(例如日期变更线两侧的极端偏移组合),视为 bug:`console.error` 并回退到 `NO_ENTRIES`,不再新增第二套「计算失败」文案。

**`ALL_OFF` / `PARTIAL_OFF` 的 `nextOverlap`**:从明天起,以参考时区的日历日为单位向后逐日搜索——每天各自生成一条完整的 48 槽轴并计算 `overlap`(与当天的算法完全一致),取第一个 `overlap` 非空的日期,返回该日期的星期与时段。上限 7 天;超出上限仍未找到则返回 `null`,UI 不渲染这一行,而不是再补一句兜底文案。

文案示例(UI 层渲染,`core/` 本身不含任何文案字符串):

```
OVERLAP            Overlap 11:00–18:00
NO_OVERLAP_TODAY   No overlap today
                   Closest — 22:00 yours / 09:00 Shanghai's
ALL_OFF            Everyone's off today
                   Next overlap — Mon 11:00–18:00
PARTIAL_OFF        Only Shanghai is working today
                   Next full overlap — Mon 11:00–18:00
NO_ENTRIES         Add a city to compare
```

### 5.4 单条目

只有一个条目时,`overlap` 就是该条目的工作时段本身,不算异常,正常渲染。

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
- 设置页中 Pro 分区加 `PRO` 标签,标签是信息不是障碍
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
`12/24` 与排序移入设置页,原胶囊整体删除。

原 logo 点击弹出的 Share / Rate / Feedback 菜单已移除 —— logo 的点击目标现在是上述
基准时区 chip。该菜单的内容迁移到设置页的 About 分区,见 §9.4。

### 9.2 卡片

- 高度压缩至 60–64px(当前约 86px)。底部面板会占去约 140px,不压缩则 540px 高度下仅能露出 4 张卡片
- 本版不实现头像列。但卡片内部布局请预留左侧插入一列的余地,避免下一版重写
- 保留天空渐变背景 —— 这是产品的核心视觉资产
- 秒数默认关闭
- 滑动菜单统一为左侧单列三格:`⚙ 设置 · 📌 置顶 · ✕ 删除`
- **删除按钮改为红色**(当前为琥珀色,不符合破坏性操作惯例)
- 首次使用时第一张卡片播放一次左移回弹动画,提供手势可发现性

**底部信息栏**

```
左:相对差值(主) + UTC 偏移(次)        右:[yesterday / tomorrow |] 星期 | 日期

Base   UTC+09                          TUE | 22 SEP    ← 基准时区对应的条目
−13h   UTC−04              yesterday | MON | 21 SEP    (强调色)
+5h    UTC+14               tomorrow | WED | 23 SEP    (强调色)

+25h   UTC+14                          TUE | 23 SEP    (强调色,无说明)
       ↑ 基准换成 Niue(SUN 21 SEP 23:30)时的 Kiritimati:跨日期变更线相差两日
```

- **左侧以基准时区为参照。** 基准即头部 chip 的 `settings.referenceTimezone`(`null` 取系统时区)。
  差值由 `core/tz.ts` 的 `relativeOffsetMinutes()` 计算,取卡片**当前显示的那一刻**(转换模式下即
  转换器所选时刻),不缓存 —— DST 期间同一对城市的差值会变(§4.2)。UI 层只负责渲染。
- **格式**:整点 `+2h` / `−13h`;非整点写成 `+3:30h` / `+5:45h`,不用小数。
- 与基准时区 **IANA id 相同**的条目显示 `Base`,不显示 `+0h`。id 不同但此刻偏移恰好相同的条目
  (如首尔 vs 东京)显示 `0h` —— 两者在 DST 期间可能分开,不能冒充基准。
- **UTC 偏移保留,降为次级**(更小、更暗):`UTC+09` / `UTC−04` / `UTC+05:45`,零偏移为 `UTC`。
  它是无歧义的可信度锚点,不删除。不显示时区缩写(§4.2)。
- **右侧星期 + 日期对所有条目照常显示**,不做「仅在与基准不同日时显示」的条件隐藏。条目本地日期
  与基准时区日期不同(`localDayDelta() ≠ 0`)时,整段改用强调色;相差 ±1 日时在星期**之前**加相对
  说明 `yesterday` / `tomorrow`,与星期之间用和「星期 | 日期」相同的细分隔线隔开。强调状态下两条
  分隔线都随强调色(`currentColor`),不单独保留白色。跨日期变更线相差 ±2 日
  (`Pacific/Kiritimati` vs `Pacific/Niue`)时只保留强调色,不加说明。
- 强调色使用 token `--color-day-shift`,目前为占位(暂指向 `--color-secondary`)。最终取值待橙色
  语义收敛后确定,届时只改 token,不改使用处。
- 设置页排序项 **By offset** 按同一相对差值升序排列(最落后的在前)。

### 9.3 Core Time 面板

底部常驻,非 tab。收起时只显示结论行,展开显示色带。
**色带配色复用卡片的天空渐变色板**,使两个视图共用同一套颜色语言。

### 9.4 设置页

popup 内滑入式面板,不开新标签页。导航深度不超过两层。

当前已实现的分区,按顺序:

- **Display** — Hour format / Show seconds / Sort order
- **Core time** — Core Time panel 显示模式 / Default work hours / Default work days
- **About**(本版新增,不在最初的分区规划内)— Share TimeMate(复制商店链接,
  按钮文案短暂变为 "Copied!")/ Rate on Chrome Store / Send Feedback / Version
  (读取 `package.json` 的版本号,而非写死字符串)。这里收纳的是原头部 logo 弹出
  菜单的内容。

**DST alerts** 与 **Account** 两个分区仍未实现,分别等待构建顺序(§11)第 7、8 步
(`dst.js` 检测与横幅、接入 ExtPay)完成后再加入。注意 **About ≠ Account**:About 是
产品信息与反馈入口(本节新增),Account 届时用于订阅与权益相关设置(见 §8),两者
用途不同,不要合并成一个分区。

(People 分区下一版加入)

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

- Tokyo + Boston,默认工时 → `overlap` 为空,`closest` 非空
- Tokyo + Singapore + Berlin,默认工时 → `overlap` = 16:00–18:00 JST
- 单条目 → `overlap` = 自身工作时段
- 全部条目 `includeInCoreTime: false` → 空状态,且不报错
- 某条目 `workDays` 为空数组 → 该条目永不参与,`overlap` 为空

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

下一版:人物模式 + 分组 + Core Time 周视图。

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
