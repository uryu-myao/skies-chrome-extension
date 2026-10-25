# Skies 开发日志

按版本记录做了什么、为什么这样做。行为的唯一依据仍是 `docs/spec-v2.md`;这里记的是来龙去脉。

---

## 3.3.2 — 评分请求卡片

规格见 spec §9.7(卡片)与 §9.4(About)。

### 卡片什么时候出现

逻辑在 `shouldShowRatingPrompt()`(`src/core/ratingPrompt.ts`),以下四类条件必须同时满足:

1. **还有资格再问**
   - `status` 是 `pending`:点过评分、点过反馈、或第 2 次被 Not now 之后,永远不再出现
   - 一共最多出现 2 次(`shownCount < 2`)
   - 已经出现过 1 次的话,距离上次出现要满 14 天
2. **用户已经从扩展得到过价值**(满足其一)
   - (a) 用户在之前某一次打开时看到过 DST 横幅。本次打开刚看到的不算,卡片等下一次打开才出现,不会和横幅同时出现
   - (b) 距第一次打开满 7 天,且打开次数至少 10 次。老用户从升级后第一次打开开始计
3. **界面上没有别的东西**
   - 不在编辑模式
   - 设置页、城市设置面板都没有打开
   - 顶部没有显示 DST 横幅
4. **本次打开还没被关掉**:在这次 popup 里点过三个按钮中任何一个,卡片消失,直到下次打开

### 怎么计数

- 卡片在一次打开里真正渲染出来,算出现 1 次;一次打开最多算 1 次
- 中途打开设置页,卡片暂时隐藏;关掉设置页会回来,但不会再计一次
- 用户什么都不点直接关掉 popup,也算出现过 1 次

### Not now 按钮

- 第 1 次出现时点 Not now:本次打开内隐藏,状态保持 `pending`;满 14 天后,只要条件 2 和 3 仍满足,会再出现一次
- 第 2 次出现时点 Not now:状态变为 `dismissed`,永远不再出现
- 第 2 次出现时什么都不点:出现次数已到 2 次,同样不会再出现
- 每个用户最多被问两次,两次之间至少隔 14 天

### 其他按钮

- Rate → `rated`;Send feedback → `feedback`
- 设置页里的 Rate Skies 和 Recent updates 下方的 "a rating" 链接也记为 `rated`

### 约束

- 没有新增任何 manifest 权限:Chrome 仍不声明任何权限,Firefox 仍只有 `storage`
- 状态只存在扩展的本地存储里,不发送任何数据:一个 key `timemate.rating-prompt.v1`,经现有存储适配层
  读写 —— Chrome 是 popup 页的 `localStorage`,Firefox 是 `browser.storage.local`(spec §2.3)。
  不用 `chrome.storage.local`:Chrome 版没有 `storage` 权限
- 商店与链接按编译期常量 `__TARGET__` 选定,每个包只带自己那家商店的链接(`src/config/links.ts`)
- 强制显示卡片的调试入口(`?rating-prompt`)只在开发服务器里存在,生产构建里没有
- About 的 Recent updates 条目未改
