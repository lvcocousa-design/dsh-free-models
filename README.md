# dsh-free-models

English | [中文](#中文说明)

Free-tier model fallback for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).
It adds one virtual provider, `free-auto`. A request goes to the first available free-tier model in your
chain (default: Zhipu GLM-4.7-Flash on the China site, then the same model on Z.ai international, then Gemini, then OpenRouter `:free` models, then Mistral). If that provider is out of
quota, the request moves to the next one. A settings page shows the order, each provider's status and
today's usage.

This is an unofficial community plugin. It is not affiliated with DeepSeek, Zhipu, Google, OpenRouter, Mistral, Groq, Cloudflare, ModelScope or NVIDIA.

## Read this first: what it can and cannot guarantee

- **It cannot guarantee you are never billed.** Whether a call costs money is decided by the provider and by
  your account settings, not by this plugin. Use a key from an account or project that has **no billing
  attached**. With no billing, the provider answers 429 at the limit instead of charging.
- What the plugin does on top: it only sends calls to models its presets list as free; it requires the
  `:free` suffix on OpenRouter; it never sends Gemini models Google lists as not free (Gemini 4 Carbon,
  Argon, Neon, 3.1 Pro Preview); it stops using a provider at 80% of a published daily limit; it treats a
  429 as "exhausted" until the reset time; it stops using a route that answers 402 (payment request) until you press **Re-enable**; and a global
  switch (**on by default**) refuses anything that could be billable. Providers whose billing depends on the account
  (Gemini, Mistral, Groq, Cloudflare) must be confirmed once as "this account has no billing attached" before they are used.
- Free tiers change. Numbers in `packages/presets` carry a `verifiedAt` date and some are marked
  `unverified`. Run `pnpm check:models` before relying on them.
- Free tiers on several providers may use your prompts to improve their products. Gemini's free tier says so
  explicitly. The other presets are flagged the same way as a precaution. Do not send code you cannot share.
- Keys live in dsh's credential store (`~/.dsh/.credentials.yaml`, owner-only file mode, **plaintext**). Any
  process that runs as you, including agent tool processes, can read it. This plugin never stores key values.
- Compliance: use **one account per provider that you own**. Do not rotate several accounts to get around
  limits. That usually breaks provider terms and can get all of them banned. The plugin has no such feature.

## Compatibility

Tooling: Node 24.9+ (as dsh requires), pnpm 12 (the repo pins it in `packageManager`; `pnpm install` is clean on it).

Built and tested against dsh `0.2.2-rc.5` (npm tag `next`). The bundle declares `engines.dsh: >=0.2.2-rc.5 <0.3.0`.
dsh is pre-1.0 and its plugin APIs move, so other versions are untested.

## Install

```sh
git clone https://github.com/lvcocousa-design/dsh-free-models && cd dsh-free-models
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
(`google`, `openrouter`, `mistral`). The page stores it through dsh's credential system. Zhipu and ModelScope need a one-time route declaration first, see [Zhipu, ModelScope, Cloudflare and NVIDIA](#zhipu-modelscope-cloudflare-and-nvidia).

| Provider | Where | Notes |
| --- | --- | --- |
| Gemini | https://aistudio.google.com/apikey | Pick a Google Cloud project with no billing account linked. |
| OpenRouter | https://openrouter.ai/settings/keys | Do not buy credits if you want a hard stop. Free models: 20 requests/min, 50/day (1000/day after a one-time $10 purchase, which this plugin does not assume). |
| Mistral | https://console.mistral.ai/api-keys | Keep the workspace in Free mode. |
| Zhipu, China site `zhipu` (default chain, first) | https://open.bigmodel.cn/usercenter/apikeys/ | Free model: GLM-4.7-Flash. Per the official FAQ, calling the API does **not require real-name verification** (it is recommended, not forced), and overseas phone numbers can register. Other Flash models are billed and are blocked by the plugin. |
| Z.ai international `zhipu-intl` (default chain, second) | https://docs.z.ai/guides/develop/http/introduction | Register on the Z.ai platform and create a **standard API key**. Do **not** use a GLM Coding Plan key: since 2026-10-16 the two key types do not work for each other. Free models: GLM-4.7-Flash, GLM-4.5-Flash. The official pages list no real-name or card requirement for free models (I did not sign up to test it). |
| Groq (optional, off by default) | https://console.groq.com/keys | Free plan only. Small token limits make it fit short tasks, not long agent runs. |
| Cloudflare Workers AI (optional, off by default) | https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ | Needs a Workers AI API token **and** your account id. Stay on the Free Workers plan. |
| ModelScope (optional, off by default) | https://modelscope.cn/my/myaccesstoken | Non-commercial. The account must be linked to a real-name-verified Alibaba Cloud account. |
| NVIDIA API catalog (optional, off by default) | https://build.nvidia.com/search | Trial terms only, and NVIDIA may use prompts to improve its products. |

## Limits at a glance

| Provider | Free allowance used by the plugin | Resets | Overage |
| --- | --- | --- | --- |
| Zhipu GLM-4.7-Flash (China) | Free model, limited by concurrency (requests in flight); the number is only in your console | n/a | Refuses (429); a free model has no billing path |
| Z.ai GLM-4.7-Flash / 4.5-Flash (international) | Free models, limited by concurrency; the number is shown after login at z.ai/manage-apikey/rate-limits | n/a | Refuses (429); no billing path for free models |
| Gemini | Per model and per project; see AI Studio for your numbers (not hard-coded) | Pacific midnight | Refuses (429) with no billing; bills if billing is linked |
| OpenRouter `:free` | 20/min, 50/day across all free models | UTC midnight | Refuses (429) |
| Mistral | Free mode, lowest limits; no official numbers (not hard-coded) | Unknown, so the plugin backs off and retries | Refuses in Free mode |
| Groq | 30 RPM, 1K RPD, 8K TPM, 200K TPD per model | UTC midnight | Refuses on Free plan |
| Cloudflare Workers AI | 10,000 Neurons per day per account (about 100K tokens on these models, my estimate from the price list) | 00:00 UTC | Free plan: fails. Workers Paid plan: **billed** |
| ModelScope | Metered in "Magic Beans" per call; the official page no longer states a daily number | Unknown | Refuses |
| NVIDIA | about 40 requests per minute per account | n/a | No per-token billing; past the limit NVIDIA points to paid deployment |

Sources and check date (2026-11-20): Zhipu https://open.bigmodel.cn/pricing , Z.ai https://docs.z.ai/guides/overview/pricing , Cloudflare
https://developers.cloudflare.com/workers-ai/platform/pricing/ , ModelScope
https://www.modelscope.cn/docs/model-service/API-Inference/limits.md , NVIDIA https://build.nvidia.com/search .

Excluded on purpose: Cerebras (a trial that needs a payment method) and GitHub Models (retired 2026-07-30).

## Zhipu, ModelScope, Cloudflare and NVIDIA

**China site vs international site.** `zhipu` is open.bigmodel.cn (yuan, China phone login, overseas numbers accepted).
`zhipu-intl` is z.ai (USD, separate account and key, run from Singapore). They are separate accounts with separate
keys and concurrency limits, so they back each other up in the default chain. Real-name verification: the China site's
official FAQ says it is not required for API calls (https://docs.bigmodel.cn/cn/faq/authentication-issues); the
international pages list no such requirement.
Privacy: for API use, Z.ai's data addendum says it does not store the content you send or receive. It makes **no explicit
promise that content is never used for training**, so do not treat it as one. For the China site I found no official statement either way.
The key name for the international route is `ZAI_STANDARD_API_KEY`, not `ZAI_API_KEY` (dsh uses that one for the Coding Plan).

**Zhipu (both sites) and ModelScope** are not routes that dsh ships, so declare each once in the pi-ai plugin row of your
profile (merge with the providers you already have). The key goes under the credential name, never in the file:

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      zhipu:
        apiKeyEnv: ZHIPU_API_KEY
        api: openai-completions
        baseURL: https://open.bigmodel.cn/api/paas/v4/
        models:
          - { id: glm-4.7-flash, name: GLM-4.7-Flash, contextWindow: 200000 }
      zhipu-intl:   # Z.ai international, standard API key (not a Coding Plan key)
        apiKeyEnv: ZAI_STANDARD_API_KEY
        api: openai-completions
        baseURL: https://api.z.ai/api/paas/v4
        models:
          - { id: glm-4.7-flash, name: GLM-4.7-Flash, contextWindow: 200000 }
      modelscope:   # optional
        apiKeyEnv: MODELSCOPE_ACCESS_TOKEN
        api: openai-completions
        baseURL: https://api-inference.modelscope.cn/v1/
        models:
          - { id: Qwen/Qwen3.5-35B-A3B, name: Qwen3.5 35B A3B, contextWindow: 131072 }
```

Provide the key as an environment variable of that name (tested in the end-to-end test). Storing it through dsh's
credential store under the same name should work the same way, but I have not run that path.
If a route is not declared, the router skips it (it shows as stopped with "route is not set up in dsh") and uses the next entry.
The plugin only calls models its presets list. For Zhipu that is `glm-4.7-flash` (the international preset also lists `glm-4.5-flash`, not in the default chain); `glm-5.3-flash`, `glm-5.3-flashx`,
`glm-4.7-flashx` and `glm-4.6v-flashx` are refused because they are billed. If you declare only one of the two Zhipu routes, the other is skipped.

**Cloudflare** and **NVIDIA** are routes dsh already ships (`cloudflare-workers-ai`, `nvidia`). Cloudflare needs two
credential names: `CLOUDFLARE_API_KEY` (an API token with Workers AI permission) and `CLOUDFLARE_ACCOUNT_ID`.
Find the account id in the Cloudflare dashboard under Workers & Pages, "Account ID" on the right. It is not secret,
but dsh builds the URL from it. Cloudflare says it does not train on or keep Workers AI content.

**Groq, Cloudflare, ModelScope and NVIDIA are off by default.** The two Zhipu routes (`zhipu`, `zhipu-intl`) are the first two entries of the default chain. Add an optional entry from the settings page, or in the router row:

```yaml
- id: llm-free-router
  config:
    confirmedNoBilling: { cloudflare-workers-ai: true }   # Cloudflare only, if the account is on the Free plan
    chain:
      - { route: zhipu, model: glm-4.7-flash, enabled: true }
      - { route: cloudflare-workers-ai, model: '@cf/zai-org/glm-4.7-flash', enabled: true }
```

Compliance notes: **NVIDIA** is trial use only (not production) and its terms let NVIDIA use your content to improve
its products, so it is skipped when `sensitiveRequests` is on. **ModelScope** is free for non-commercial use, not for
production. Model lists change; ModelScope retires old models. `pnpm check:models` checks ModelScope and NVIDIA when you set
`MODELSCOPE_ACCESS_TOKEN` / `NVIDIA_API_KEY`; Zhipu and Cloudflare are not checked by the script. Whether the ModelScope and NVIDIA models
accept tool calls is not stated on the official pages, so they are marked `unverified`.

## How switching works

- The router switches provider only **before the first content chunk**. Once text or tool output has started,
  an error is returned as is. Switching mid-answer would mix two models.
- Usage chunks of a failed attempt are dropped. The reply carries one usage chunk, before `finish`.
- Reasoning signatures from one provider cannot be replayed to another. After a switch, earlier turns reach the
  new provider as plain content. When a turn lands on the same provider again it gets its own state back.
- `contextWindow` reported to dsh is the smallest window in the usable chain (default minimum 128000 tokens).
  Long conversations that fit the first model may be refused by a smaller one in the chain.
- An invalid-request error (HTTP 400) is returned as is. It is not replayed on every provider.
- A bad or missing key pauses that provider for one hour and then tries it again, so a corrected key works without
  a restart. A payment request (HTTP 402) pauses it until you press **Re-enable** on the settings page (or restart dsh).
- When every entry is unavailable, the error says which ones and when the earliest recovers. A wait of up to
  10 s is reported as a rate limit with a retry delay, which dsh's retry plugin (`dsh-llm-retry`, if mounted)
  retries within its default limits. A longer wait, such as a spent daily allowance, is reported as a quota error
  and ends the turn with that message. (Read from the dsh source, `dsh-llm-retry` defaults; not run live.)

## Configuration without the settings page

Every setting is a field of the `llm-free-router` row. Edit it in the profile's `cordis.patch.yml`, or use the
settings page, which writes the same fields. Defaults are safe: **Gemini and Mistral are skipped until you
confirm "no billing attached"**, so on a first run set that yourself:

```yaml
- id: llm-free-router
  config:
    confirmedNoBilling: { google: true, mistral: true }   # only if those accounts have no billing attached
```

| Field | Default | Meaning |
| --- | --- | --- |
| `chain` | Zhipu China `zhipu` GLM-4.7-Flash, Z.ai `zhipu-intl` GLM-4.7-Flash, Gemini (2 models), OpenRouter `:free` (2 models), Mistral Small | Ordered `{ route, model, enabled }` entries. Only models in the presets (or `:free` ids on OpenRouter) are allowed. |
| `forbidBillableCalls` | `true` | Refuse anything that could be billed. |
| `confirmedNoBilling` | `{}` | Per route, your statement that the account behind the key has no billing. Needed for `google`, `mistral`, `groq`, `cloudflare-workers-ai`. |
| `allowBilling` | `{}` | Per route opt-in for providers that bill on their own. Needs `forbidBillableCalls: false`. No shipped preset needs it. |
| `minContext` | `128000` | Skip models with a smaller context window. |
| `sensitiveRequests` | `false` | Skip providers whose free tier may use prompts for training. Check which presets are flagged before turning it on, since it can leave no usable entry. |
| `switchPolicy` | `priority` | `priority` or `sticky`. |
| `softLimitRatio` | `0.8` | Stop using a provider at this share of its published daily limit (only where limits are published). |
| `statusPage` | `true` | Serve usage counters at `/free-models/status`. |

## Settings page

Open **Settings > Free models**. You can reorder and toggle the fallback chain,
add presets, see status and today's request count per provider, confirm "no billing attached" (shown only for providers where billing depends on the account), re-enable a stopped provider, turn the
billing guard and sensitive-code options on or off, and set the minimum context. "Skip Gemini" turns off every
Gemini entry in one click. Strings are in English and Chinese.

Usage counters are in memory and reset when dsh restarts. They come from `GET /free-models/status`. On
`0.2.2-rc.5` the web server cannot require authentication for plugin routes, so anyone who can reach your dsh web
port can read those counters (no keys, no prompts). The "Try again" button posts to `/free-models/reset` (needs a custom header and refuses other origins). Keep dsh bound to localhost, or set
`statusPage: false` for the router row to turn the status endpoint off. Newer dsh builds enforce the `auth: 'required'` the plugin requests.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems as described in [SECURITY.md](SECURITY.md).

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

它提供一个虚拟提供商 `free-auto`：请求先发给链条里第一个可用的免费模型（默认先智谱国内站 GLM-4.7-Flash，再智谱国际站 Z.ai 的同一模型，其次 Gemini，再次 OpenRouter 的 `:free` 模型，最后 Mistral），
某家额度用完就自动换下一家。设置页可以调整顺序、查看各家状态和今日用量。

### 先看这几条

- **无法保证绝不扣费。** 是否收费由提供商和你的账号设置决定，不是本插件。请使用**没有绑定任何付费方式**的账号或项目申请密钥，
  这样到达上限时提供商只会返回 429，不会扣费。
- 插件额外做了：只调用预设里标为免费的模型；OpenRouter 必须带 `:free` 后缀；Gemini 4 Carbon/Argon/Neon 和 3.1 Pro Preview 永远不会被调用；
  达到公布的每日额度 80% 就停用该提供商；429 视为已耗尽直到重置；收到 402 就停用该路由，直到你在设置页点“重新启用”；全局“禁止可能计费的调用”默认开启；
  账单取决于账号的提供商（Gemini、Mistral、Groq、Cloudflare）首次启用前必须确认“该账号没有绑定付费方式”。
- 免费政策经常变化。预设里有核对日期，部分数字标为“未核实”。使用前先运行 `pnpm check:models`。
- 多家免费层可能把你的提示词用于改进产品（Gemini 官方明确如此，其余按保守处理）。不能外传的代码不要发。
- 密钥保存在 dsh 的凭据库 `~/.dsh/.credentials.yaml`（仅所有者可读，但是**明文**），以你身份运行的进程（包括 agent 工具进程）都能读到。插件本身不保存密钥。
- 合规：每家只用**自己的一个账号**，不要轮换多个账号来绕过限额，这通常违反服务条款，可能导致全部封号。本插件没有这类功能。

### 兼容性

基于 dsh `0.2.2-rc.5`（npm 的 `next` 标签）开发和测试，声明 `engines.dsh: >=0.2.2-rc.5 <0.3.0`。其他版本未测试。

### 安装

```sh
git clone https://github.com/lvcocousa-design/dsh-free-models && cd dsh-free-models
pnpm install
pnpm build
dsh plugin --profile <名称> add ./packages/llm-free-router
dsh plugin --profile <名称> add ./packages/client-ui     # 可选：设置页
dsh --profile <名称>
```

在 dsh 里选择提供商 `free-auto`，模型 `auto`。各家密钥在 dsh 的“模型”页面按路由（`google`、`openrouter`、`mistral`）填写。智谱和魔搭要先声明一次路由，见下面的“智谱、魔搭、Cloudflare、NVIDIA”。

### 申请密钥

| 提供商 | 地址 | 注意 |
| --- | --- | --- |
| Gemini | https://aistudio.google.com/apikey | 选择没有关联结算账号的 Google Cloud 项目 |
| OpenRouter | https://openrouter.ai/settings/keys | 想要硬性停止就不要充值。免费模型每分钟 20 次、每天 50 次 |
| Mistral | https://console.mistral.ai/api-keys | 保持 Free 模式 |
| 智谱国内站 `zhipu`（默认链第一位） | https://open.bigmodel.cn/usercenter/apikeys/ | 免费模型 GLM-4.7-Flash。官方 FAQ 写明调用 API **不强制实名认证**（建议但不强制），支持海外手机号注册。其他 Flash 型号收费，插件会拒绝调用 |
| 智谱国际站 Z.ai `zhipu-intl`（默认链第二位） | https://docs.z.ai/guides/develop/http/introduction | 在 Z.ai 平台注册并创建**标准 API Key**，**不要**用 GLM Coding Plan 的 Key（2026-10-16 起两种 Key 互不通用）。免费模型 GLM-4.7-Flash、GLM-4.5-Flash。官方页面没有写免费模型需要实名或绑卡（我没有实际注册验证） |
| Groq（可选，默认不启用） | https://console.groq.com/keys | 只用 Free 计划，token 限额小，适合短任务 |
| Cloudflare Workers AI（可选，默认不启用） | https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ | 需要有 Workers AI 权限的 API Token **和**账号 ID，保持 Free Workers 计划 |
| 魔搭 ModelScope（可选，默认不启用） | https://modelscope.cn/my/myaccesstoken | 仅限非商业。账号要绑定已实名认证的阿里云账号 |
| NVIDIA API 目录（可选，默认不启用） | https://build.nvidia.com/search | 仅限试用条款，NVIDIA 可能把提示词用于改进产品 |

已刻意排除：Cerebras（试用需要绑卡）、GitHub Models（2026-07-30 已下线）。

### 智谱、魔搭、Cloudflare、NVIDIA

**国内站和国际站。** `zhipu` 是 open.bigmodel.cn（人民币，手机号登录，支持海外号码）；`zhipu-intl` 是 z.ai（美元，独立账号和 Key，服务从新加坡提供）。
两边账号、Key、并发限制各自独立，所以在默认链里互相兜底。实名认证：国内站官方 FAQ 写明调用 API 不强制
（https://docs.bigmodel.cn/cn/faq/authentication-issues）；国际站官方页面没有这项要求。
隐私：Z.ai 的 API 数据处理补充协议写明不存储你发送和生成的内容，但**没有明确承诺不用于训练**，不要当成这个承诺。国内站我没找到官方说明。
国际站路由的凭据名是 `ZAI_STANDARD_API_KEY`，不是 `ZAI_API_KEY`（dsh 用后者放 Coding Plan 的 Key）。

**限额概览（核对日期 2026-11-20，官方页面）：**

| 提供商 | 免费额度 | 用尽后 |
| --- | --- | --- |
| 智谱国内站 GLM-4.7-Flash | 免费模型，按并发数限制，数字只在控制台可见 | 返回 429，没有计费通道 |
| 智谱国际站 Z.ai GLM-4.7-Flash / 4.5-Flash | 免费模型，按并发数限制，数字登录后在 z.ai/manage-apikey/rate-limits 查看 | 返回 429，免费模型没有计费通道 |
| Cloudflare | 每个账号每天 1 万 Neurons，UTC 0 点重置（按价目表我估算约 10 万 token，非官方数字） | 免费计划直接失败；**Workers Paid 计划会扣费** |
| 魔搭 | 按“魔粒”计量，官方页面不再公布每日数字 | 拒绝调用 |
| NVIDIA | 每个账号约每分钟 40 次 | 没有按 token 计费，超出后官方引导到付费部署 |

**智谱和魔搭**不是 dsh 自带的路由，需要在 profile 里的 pi-ai 插件配置里声明一次（和已有的 providers 合并）。密钥只用凭据名，不写进文件：

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      zhipu:
        apiKeyEnv: ZHIPU_API_KEY
        api: openai-completions
        baseURL: https://open.bigmodel.cn/api/paas/v4/
        models:
          - { id: glm-4.7-flash, name: GLM-4.7-Flash, contextWindow: 200000 }
      zhipu-intl:   # Z.ai 国际站，标准 API Key（不是 Coding Plan 的 Key）
        apiKeyEnv: ZAI_STANDARD_API_KEY
        api: openai-completions
        baseURL: https://api.z.ai/api/paas/v4
        models:
          - { id: glm-4.7-flash, name: GLM-4.7-Flash, contextWindow: 200000 }
      modelscope:   # 可选
        apiKeyEnv: MODELSCOPE_ACCESS_TOKEN
        api: openai-completions
        baseURL: https://api-inference.modelscope.cn/v1/
        models:
          - { id: Qwen/Qwen3.5-35B-A3B, name: Qwen3.5 35B A3B, contextWindow: 131072 }
```

密钥用同名环境变量提供（端到端测试验证过这条路径）。通过 dsh 凭据库按同名保存应该同样有效，但我没有跑过。
没声明的路由会被跳过（显示为已停用，原因里写“route is not set up in dsh”），自动用下一个条目。
插件只调用预设里列出的模型。智谱只有 `glm-4.7-flash`（国际站预设另有 `glm-4.5-flash`，不在默认链里）；`glm-5.3-flash`、`glm-5.3-flashx`、`glm-4.7-flashx`、`glm-4.6v-flashx` 因为收费被拒绝。两条智谱路由只声明了一条时，另一条会被跳过。

**Cloudflare 和 NVIDIA** 是 dsh 已有的路由（`cloudflare-workers-ai`、`nvidia`）。Cloudflare 需要两个凭据名：`CLOUDFLARE_API_KEY`（有 Workers AI 权限的 API Token）
和 `CLOUDFLARE_ACCOUNT_ID`。账号 ID 在 Cloudflare 控制台 Workers & Pages 页面右侧的 “Account ID”。它不是机密，但 dsh 用它拼接请求地址。
Cloudflare 官方说明不会用 Workers AI 的内容训练模型，也不保留输入输出。

**Groq、Cloudflare、ModelScope、NVIDIA 默认不启用**；智谱两条路由（`zhipu`、`zhipu-intl`）是默认链的前两位。可选项在设置页里手动添加，或在路由配置里写：

```yaml
- id: llm-free-router
  config:
    confirmedNoBilling: { cloudflare-workers-ai: true }   # 仅 Cloudflare，账号在 Free 计划时才确认
    chain:
      - { route: zhipu, model: glm-4.7-flash, enabled: true }
      - { route: cloudflare-workers-ai, model: '@cf/zai-org/glm-4.7-flash', enabled: true }
```

合规提示：**NVIDIA** 仅限试用、不得用于生产，条款允许 NVIDIA 用你的内容改进产品，所以打开 `sensitiveRequests` 时会被跳过。
**魔搭**仅限非商业使用，不能用于生产。魔搭会下架旧模型，模型清单会变。`pnpm check:models` 在设置了 `MODELSCOPE_ACCESS_TOKEN` / `NVIDIA_API_KEY` 时会检查这两家，
智谱和 Cloudflare 脚本不检查。魔搭和 NVIDIA 的模型是否支持工具调用，官方页面没写，所以标为“未核实”。

### 切换规则

只在收到**第一个内容块之前**切换提供商；一旦开始输出，出错就原样返回。切换后，之前轮次的思考签名降级为普通文本。
上报给 dsh 的上下文窗口是链条中最小的窗口。全部不可用时，错误信息会列出各条目以及最早恢复时间。

### 设置页

“设置 > 免费模型”：调整并开关回退顺序、查看各家状态和今日请求数、确认“无付费绑定”、开关防扣费与敏感代码选项、设置最小上下文，
“跳过 Gemini”一键关闭所有 Gemini 条目。中英文界面。用量计数在内存中，dsh 重启后清零。
`0.2.2-rc.5` 的 web 服务器无法为插件路由强制鉴权，所以能访问你 dsh 端口的人可以读到计数（不含密钥和提示词）；请只监听本机，或在路由配置里设 `statusPage: false`。
