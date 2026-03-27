# 原创度与风格学习统一方案（实现依据）

本文档为唯一实现规格。原创度与风格学习**完全独立**，无任何联动计算。

---

## 一、原创度（Originality）

### 设计理念

原创度表示：**最终发布内容里「人的成分」占比**。由两部分叠加：

1. **基线**：Skill 返回的 `json:originality`（`userMaterialPct`），无则默认 **10%**。
2. **改写贡献**：前端用**字符级改写率**（非编辑次数）衡量用户相对「原始草稿」改了多少。

### 计算公式

```ts
const baselineFromSkill = originalityReport?.userMaterialPct ?? 10;
const rewriteRatio = calculateRewriteRatio(originalDraft, currentContent);
const displayedOriginality = Math.min(
  Math.max(baselineFromSkill + rewriteRatio * 90, 0),
  100,
);
```

### 改写率实现

采用规范中的**简化段落对比**（避免 LCS 过重）：

- `calculateRewriteRatio(original, current)`：`original` / `current` 为 `{ title: string; body: string }`。
- 将 `title + '\n' + body` 拆成段落数组（`split('\n').filter(Boolean)`）。
- 逐段：新增段落整段计入 `changedChars`；修改段落用逐字符前缀相同长度得到 `same`，`changedChars += para.length - same`；未改段落不计。
- `rewriteRatio = changedChars / currentTotal`，`currentTotal === 0` 时返回 `0`。

### 合规标识

```ts
const compliance =
  displayedOriginality >= 60 ? 'safe'
  : displayedOriginality >= 40 ? 'caution'
  : 'risk';
```

与现有 `complianceFromUserPct` 不一致时，**以本段为准**。

### 触发时机

1. 用户每次编辑后：**debounce 1000ms** 后重算改写率并更新展示。
2. Skill 返回新的 `json:originality`：更新基线；改写率仍基于同一 `originalDraft` vs 当前内容，再合成总值。
3. **原始草稿**：在 `json:draft` **首次**加载进编辑器时写入 `originalDraft`（及 ref），之后**不再覆盖**。

### 删除的旧逻辑（在 `XhsPostEditor.tsx`）

- `clamp(70 - editCount * 3.2, …)` 等；
- `seedUserMaterialPct` 相关；
- `modifiedCount * 0.9` 等扣减；
- 以 `editCount` 驱动 `userMaterialPct` 的任何逻辑。

---

## 二、风格学习（Style Learning）

### 设计理念

基于**修改次数**，与 **qualityScore 无关**。

### 展示与累计

```ts
const historicalEditCount = account?.cumulativeEditCount ?? 0;
const sessionEditCount = editHistory.length;
const totalEditCount = historicalEditCount + sessionEditCount;

const styleLearningProgress = Math.min(totalEditCount, 10); // 满格用
const nextMilestone = (Math.floor(totalEditCount / 10) + 1) * 10;
const progressToNext = totalEditCount % 10;
// 文案示例：`${progressToNext}/10`
```

- **不要**在 `stage < 3` 时把风格学习进度设为 0。

### 会话结束持久化

在「保存到作品集」或离开页面时合并会话编辑次数到 `account.cumulativeEditCount`。

**防重复计数**：多次保存不能每次 `+ editHistory.length`；应使用增量（`editHistory.length - persistedSessionEditCount`）或仅结束会话时写一次。

### 风格分析提示

当 `totalEditCount >= 10 && !account.hasAnalyzedStyle`：提示「已积累 10 条修改记录，可以触发风格分析」；点击发送 **「看我的修改规律」** 给 Skill。分析后更新 `hasAnalyzedStyle` / `styleAnalysisCount`（与后端约定）。

### Account 新增字段

- `cumulativeEditCount: number`
- `hasAnalyzedStyle: boolean`
- `styleAnalysisCount: number`

### 明确不做

- 不用 `qualityScore` 驱动风格学习。
- 不与原创度联动计算。

---

## 三、独立维度（关系）

| 维度 | 衡量 | 数据 | 触发 |
|------|------|------|------|
| 原创度 | 本篇「人」的成分 | Skill 基线 + 改写率 | 编辑 debounce 1s；Skill 更新基线 |
| 风格学习 | 系统积累的偏好 | 跨会话累计 + 当前 editHistory | 展示即时；保存/离开写回 |

---

## 四、主要改动文件

- `src/lib/accounts.ts` — 类型与默认值
- `src/lib/ideashuStorage.ts` — 加载时补全新字段
- `src/contexts/ActiveAccountContext.tsx` — 更新账号累计字段
- `src/components/XhsPostEditor.tsx` — 原创度、风格学习 UI、debounce、合规
- `src/pages/WorkspacePage.tsx` — 会话结束保存累计编辑
- `src/lib/openclawClient.ts`（可选）— 封装发送「看我的修改规律」

---

执行前提：收到明确指令（如「开始按文档实现」）后再改代码。
