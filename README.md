# dsh-free-models

English | [中文](#中文说明)

Free-tier model fallback for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).
It adds one virtual provider, `free-auto`. A request goes to the first available free-tier model in your
chain (default: Gemini, then OpenRouter `:free` models, then Mistral). If that provider is out of
quota, the request moves to the next one. A settings page shows the order, each provider's status and
today's usage.

This is an unofficial community plugin. It is not affiliated with DeepSeek, Google, OpenRouter, Mistral or Groq.

## Read this first: what it can and cannot guarantee

- **It cannot guarantee you are never billed.** Whether a call costs money is decided by the provider and by
  your account settings, not by this plugin. Use a key from an account or project that has **no billing
  attached**. With no billing, the provider answers 429 at the limit instead of charging.
- What the plugin does on top: it only sends calls to models its presets list as free; it requires the
  `:free` suffix on OpenRouter; it never sends Gemini models Google lists as not free (Gemini 4 Carbon,
  Argon, Neon, 3.1 Pro Preview); it stops using a provider at 80% of a published daily limit; it treats a
  429 as "exhausted" until the reset time; it disables a route for good if a provider answers 402; and a global
  switch (**on by default**) refuses anything that could be billable. Each provider must be confirmed once as
  "this account has no billing attached" before it is used.
- Free tiers change. Numbers in `packages/presets` carry a `verifiedAt` date and some are marked
  `unverified`. Run `pnpm check:models` before relying on them.
- Free tiers on several providers may use your prompts to improve their products. Gemini's free tier says so
  explicitly. The other presets are flagged the same way as a precaution. Do not send code you cannot share.
- Keys live in dsh's credential store (`~/.dsh/.credentials.yaml`, owner-only file mode, **plaintext**). Any
  process that runs as you, including agent tool processes, can read it. This plugin never stores key values.
- Compliance: use **one account per provider that you own**. Do not rotate several accounts to get around
  limits. That usually breaks provider terms and can get all of them banned. The plugin has no such feature.

## Compatibility

Built and tested against dsh `0.2.2-rc.5` (npm tag `next`). The bundle declares `engines.dsh: >=0.2.2-rc.5 <0.3.0`.
dsh is pre-1.0 and its plugin APIs move, so other versions are untested.

## Install

```sh
git clone https://github.com/<you>/dsh-free-models && cd dsh-free-models
pnpm install
pnpm build
dsh plugin --profile <name> add ./packages/llm-free-router
dsh plugin --profile <name> add ./packages/client-ui     # optional settings page
dsh --profile <name>
```

The router row is added with the id `llm-free-router`. The settings page looks the router up by that id.
Add a row of your own with a different id only if you also change `ENTRY_ID` in `packages/client-ui/src/client/index.ts`.
Select provider `free-auto`, model `auto`, in dsh.

## Get keys

Use a fresh or billing-free account. Enter each key on dsh's **Models** page under that provider's route
(`google`, `openrouter`, `mistral`). The page stores it through dsh's credential system.

| Provider | Where | Notes |
| --- | --- | --- |
| Gemini | https://aistudio.google.com/apikey | Pick a Google Cloud project with no billing account linked. |
| OpenRouter | https://openrouter.ai/settings/keys | Do not buy credits if you want a hard stop. Free models: 20 requests/min, 50/day (1000/day after a one-time $10 purchase, which this plugin does not assume). |
| Mistral | https://console.mistral.ai/api-keys | Keep the workspace in Free mode. |
| Groq (optional, off by default) | https://console.groq.com/keys | Free plan only. Small token limits make it fit short tasks, not long agent runs. |

## Limits at a glance

| Provider | Free allowance used by the plugin | Resets | Overage |
| --- | --- | --- | --- |
| Gemini | Per model and per project; see AI Studio for your numbers (not hard-coded) | Pacific midnight | Refuses (429) with no billing; bills if billing is linked |
| OpenRouter `:free` | 20/min, 50/day across all free models | UTC midnight | Refuses (429) |
| Mistral | Free mode, lowest limits; no official numbers (not hard-coded) | Unknown, so the plugin backs off and retries | Refuses in Free mode |
| Groq | 30 RPM, 1K RPD, 8K TPM, 200K TPD per model | UTC midnight | Refuses on Free plan |

Excluded on purpose: Cerebras (a trial that needs a payment method) and GitHub Models (retired 2026-07-30).

## How switching works

- The router switches provider only **before the first content chunk**. Once text or tool output has started,
  an error is returned as is. Switching mid-answer would mix two models.
- Usage chunks of a failed attempt are dropped. The reply carries one usage chunk, before `finish`.
- Reasoning signatures from one provider cannot be replayed to another. After a switch, earlier turns reach the
  new provider as plain content. When a turn lands on the same provider again it gets its own state back.
- `contextWindow` reported to dsh is the smallest window in the usable chain (default minimum 128000 tokens).
  Long conversations that fit the first model may be refused by a smaller one in the chain.
- When every entry is unavailable, the error says which ones and when the earliest recovers. A short wait is
  reported as a rate limit, so dsh's retry plugin handles it; a daily exhaustion is reported as a quota error.

## Settings page

Open **Settings > Free models**. You can reorder and toggle the fallback chain,
add presets, see status and today's request count per provider, confirm "no billing attached", turn the
billing guard and sensitive-code options on or off, and set the minimum context. "Skip Gemini" turns off every
Gemini entry in one click. Strings are in English and Chinese.

Usage counters are in memory and reset when dsh restarts. They come from `GET /free-models/status`. On
`0.2.2-rc.5` the web server cannot require authentication for plugin routes, so anyone who can reach your dsh web
port can read those counters (no keys, no prompts). Keep dsh bound to localhost, or set `statusPage: false` for
the router row to turn the endpoint off. Newer dsh builds enforce the `auth: 'required'` the plugin requests.

## Development

```sh
pnpm install
pnpm test            # unit and contract tests; no network
pnpm typecheck
pnpm build
pnpm check:models    # compares presets with live model lists
LIVE_TEST=1 GEMINI_API_KEY=... OPENROUTER_API_KEY=... pnpm test   # real calls, off by default
```

Layout: `packages/core` (quota, guard, failure classification; no dsh imports), `packages/presets` (one file per
provider), `packages/llm-free-router` (the adapter), `packages/client-ui` (settings page).
Update a preset by editing its file and its `verifiedAt` date, then run the tests.

License: MIT.

---

## 中文说明

给 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 用的免费额度模型回退插件。非官方社区项目。

它提供一个虚拟提供商 `free-auto`：请求先发给链条里第一个可用的免费模型（默认 Gemini，其次 OpenRouter 的 `:free` 模型，再次 Mistral），
某家额度用完就自动换下一家。设置页可以调整顺序、查看各家状态和今日用量。

### 先看这几条

- **无法保证绝不扣费。** 是否收费由提供商和你的账号设置决定，不是本插件。请使用**没有绑定任何付费方式**的账号或项目申请密钥，
  这样到达上限时提供商只会返回 429，不会扣费。
- 插件额外做了：只调用预设里标为免费的模型；OpenRouter 必须带 `:free` 后缀；Gemini 4 Carbon/Argon/Neon 和 3.1 Pro Preview 永远不会被调用；
  达到公布的每日额度 80% 就停用该提供商；429 视为已耗尽直到重置；收到 402 就永久停用该路由；全局“禁止可能计费的调用”默认开启；
  每个提供商首次启用前必须确认“该账号没有绑定付费方式”。
- 免费政策经常变化。预设里有核对日期，部分数字标为“未核实”。使用前先运行 `pnpm check:models`。
- 多家免费层可能把你的提示词用于改进产品（Gemini 官方明确如此，其余按保守处理）。不能外传的代码不要发。
- 密钥保存在 dsh 的凭据库 `~/.dsh/.credentials.yaml`（仅所有者可读，但是**明文**），以你身份运行的进程（包括 agent 工具进程）都能读到。插件本身不保存密钥。
- 合规：每家只用**自己的一个账号**，不要轮换多个账号来绕过限额，这通常违反服务条款，可能导致全部封号。本插件没有这类功能。

### 兼容性

基于 dsh `0.2.2-rc.5`（npm 的 `next` 标签）开发和测试，声明 `engines.dsh: >=0.2.2-rc.5 <0.3.0`。其他版本未测试。

### 安装

```sh
git clone https://github.com/<你的用户名>/dsh-free-models && cd dsh-free-models
pnpm install
pnpm build
dsh plugin --profile <名称> add ./packages/llm-free-router
dsh plugin --profile <名称> add ./packages/client-ui     # 可选：设置页
dsh --profile <名称>
```

在 dsh 里选择提供商 `free-auto`，模型 `auto`。各家密钥在 dsh 的“模型”页面按路由（`google`、`openrouter`、`mistral`）填写。

### 申请密钥

| 提供商 | 地址 | 注意 |
| --- | --- | --- |
| Gemini | https://aistudio.google.com/apikey | 选择没有关联结算账号的 Google Cloud 项目 |
| OpenRouter | https://openrouter.ai/settings/keys | 想要硬性停止就不要充值。免费模型每分钟 20 次、每天 50 次 |
| Mistral | https://console.mistral.ai/api-keys | 保持 Free 模式 |
| Groq（可选，默认不启用） | https://console.groq.com/keys | 只用 Free 计划，token 限额小，适合短任务 |

已刻意排除：Cerebras（试用需要绑卡）、GitHub Models（2026-07-30 已下线）。

### 切换规则

只在收到**第一个内容块之前**切换提供商；一旦开始输出，出错就原样返回。切换后，之前轮次的思考签名降级为普通文本。
上报给 dsh 的上下文窗口是链条中最小的窗口。全部不可用时，错误信息会列出各条目以及最早恢复时间。

### 设置页

“设置 > 免费模型”：调整并开关回退顺序、查看各家状态和今日请求数、确认“无付费绑定”、开关防扣费与敏感代码选项、设置最小上下文，
“跳过 Gemini”一键关闭所有 Gemini 条目。中英文界面。用量计数在内存中，dsh 重启后清零。
`0.2.2-rc.5` 的 web 服务器无法为插件路由强制鉴权，所以能访问你 dsh 端口的人可以读到计数（不含密钥和提示词）；请只监听本机，或在路由配置里设 `statusPage: false`。
