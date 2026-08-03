# Hooks

Hooks（钩子）是一种自动触发机制：你预先告诉 Kimi Code CLI"每当发生 X，运行这个脚本"。脚本在你的本机执行，你可以在里面写任何逻辑。典型的使用场景：

- **安全拦截**：Agent 要执行 Shell 命令前，检查是否包含危险操作（如 `rm -rf`），包含则阻断执行
- **桌面通知**：后台任务完成时，弹出系统通知提醒你回来查看结果
- **自动检查**：每次用户提交消息时，自动在上下文里附加一些背景信息（如当前 Git 分支）

## Hooks 是怎么工作的

配置一条 hook 规则，需要指定三件事：**在什么事件上触发**、**匹配哪些目标**、**运行哪个脚本**。

触发时，CLI 会把事件的详细信息（触发原因、工具名称、命令内容等）打包成 JSON（一种结构化文本格式），通过**标准输入**（stdin，程序运行时用来接收外部数据的通道）传给你的脚本。脚本读取这些信息后，决定怎么响应。

脚本的响应结果由两样东西决定：

- **退出码**（exit code，程序结束时向操作系统报告的状态数字）：`0` 表示放行，`2` 表示阻断，其他数字默认放行
- **标准输出**（stdout，就是你用 `console.log` 或 `print` 打印出来的内容）：可以附带说明文字

即使脚本报错、超时，CLI 也**不会因此中断你的工作**——这种"出错就放行"的设计叫 fail-open（失败开放），避免 hook 异常变成绊脚石。

::: warning 注意
正因为 fail-open，Hooks 适合做提醒和轻量拦截，但**不应作为唯一的安全防线**。对真正高风险的操作，仍需依赖权限审批和人工确认。
:::

## 快速上手：一个最简单的 hook

下面这条 hook 会在每次后台任务完成时，在终端标题栏闪一下通知（macOS 需要安装 `terminal-notifier`）：

```toml
# 写在 ~/.kimi-code/config.toml 里
[[hooks]]
event = "Notification"           # 触发时机：后台任务状态变化时
matcher = "task\\.completed"     # 只关心"已完成"的通知
command = "terminal-notifier -title Kimi -message 'Task done'"
```

保存配置、重开会话，下次后台任务完成时就会弹出通知。

## 配置

所有 hook 规则写在 `~/.kimi-code/config.toml` 的 `[[hooks]]` 数组里，每一项是一条规则：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event` | `string` | 是 | 触发事件名，必须是下文「事件一览」表中的某一项 |
| `matcher` | `string` | 否 | 用正则表达式（一种字符串匹配语法）过滤事件目标；不填则匹配全部 |
| `command` | `string` | 是 | 触发时要运行的 Shell 命令 |
| `timeout` | `integer` | 否 | 超时秒数，范围 1–600；默认 30 秒 |

`[[hooks]]` 只允许这四个字段，多写会导致配置文件加载失败。

**同一事件匹配多条规则时**，所有命中的 hook 并行运行；`command` 完全相同的多条规则只运行一次。

Hook 命令的工作目录是当前会话的项目目录。非 Windows 平台上，hook 进程放在独立进程组里，超时时先发信号让它有机会善后，之后才强制终止。

### 事件数据格式

每次触发时，CLI 都会把以下基础信息通过 stdin 传给脚本：

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "session_abc",
  "cwd": "/path/to/project",
  "agent_id": "main",
  "transcript_path": "/home/you/.kimi-code/sessions/wd_project_a1b2c3/session_abc/agents/main/wire.jsonl"
}
```

`agent_id` 与 `transcript_path` 标识触发该 hook 的 agent，以及该 agent 的 wire 记录文件（wire transcript）的绝对路径——这是会话运行期间引擎持续追加写入的 JSONL 日志，脚本可以直接读取，无需自行推断会话目录结构。子 agent 的 hook 拿到的是它自己的记录文件，而不是主 agent 的。

当 CLI 无法确定这两个字段时会**直接省略**它们，因此脚本必须能处理字段缺失的情况，而不是假定一定有值。`SubagentStart` 和 `SubagentStop` 完全不带这两个字段：这两个事件描述的 agent 在该时点无法被 CLI 识别，与其给出错误的路径，不如不给。

具体事件还会附带额外字段（如工具名称、命令内容），见下方事件一览。所有字段名使用下划线命名（snake_case）。

## 返回值

脚本结束后，CLI 根据退出码判断 hook 的意图：

| 退出码 | 含义 | CLI 怎么处理 |
| --- | --- | --- |
| `0` | 正常结束，放行 | 继续执行，若标准输出（stdout）有内容可附加到上下文 |
| `2` | 主动阻断 | 停止当前操作；错误输出（stderr，`console.error` 打印的内容）作为阻断原因 |
| 其他非零值 | 脚本出错 | 默认放行（fail-open） |
| 超时或崩溃 | 脚本异常 | 默认放行（fail-open） |

也可以通过标准输出返回一段 JSON 来阻断：

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "请用 rg 代替 grep"
  }
}
```

::: info 哪些事件支持阻断？
只有**可阻断事件**（`PreToolUse`、`Stop`、`UserPromptSubmit`）的返回值会影响主流程。其余事件属于**观察型事件**——触发后即发即忘，不管脚本返回什么，主流程都不会改变。

“观察型”指的是控制流，而不是输出：`SessionStart` 无法中止或改变会话，但它的输出**会**进入模型上下文。参见[在会话开始时注入上下文](#在会话开始时注入上下文)。
:::

## 在会话开始时注入上下文

`SessionStart` 钩子的输出会作为 system reminder 追加到主 Agent 的上下文中，模型从第一轮起就能看到。适合注入静态指令文件无法承载的事实——当前分支、待办事项、部署状态等：

```toml
[[hooks]]
event = "SessionStart"
command = "echo \"当前分支：$(git branch --show-current)\""
```

脚本输出 JSON 时取其 `message` 字段，否则取原始 stdout——与 `UserPromptSubmit` 的规则一致。脚本非零退出或超时则不贡献任何文本，因此坏掉的钩子不会把垃圾喂给模型；又因为 `SessionStart` 属于观察型事件，`block` 决定既不贡献文本，也仍然不会中止会话。

两点限制：

- 只作用于**主 Agent**，子 Agent 不会收到。
- 钩子运行时若会话还没有主 Agent，输出会被丢弃。通过服务端 API 创建、且未携带主 Agent 绑定的会话就属于这种情况——它的主 Agent 是首次使用时才惰性创建的。

## 事件一览

| 事件 | Matcher 匹配的是 | 会触发阻断？ | 说明 |
| --- | --- | --- | --- |
| `UserPromptSubmit` | 用户提交的文本内容 | ✓ | 用户发送消息时触发；返回文本会附加到上下文；若阻断，本轮不调用模型 |
| `PreToolUse` | 工具名 | ✓ | 工具调用前触发（权限检查前）；阻断后工具不会执行 |
| `Stop` | 空字符串 | ✓ | 模型准备结束本轮时触发；阻断后可追加一条消息让模型继续 |
| `PostToolUse` | 工具名 | — | 工具成功执行后触发（观察用） |
| `PostToolUseFailure` | 工具名 | — | 工具失败或被阻断后触发（观察用） |
| `PermissionRequest` | 工具名 | — | 即将等待用户审批前触发（观察用） |
| `PermissionResult` | 工具名 | — | 审批结束后触发（观察用） |
| `SessionStart` | `startup` 或 `resume` | — | 新会话启动或历史会话恢复后触发；返回文本会作为 system reminder 附加到主 Agent 的上下文（参见[在会话开始时注入上下文](#在会话开始时注入上下文)） |
| `SessionEnd` | `exit` | — | 会话关闭后触发 |
| `SubagentStart` | 子 Agent 名称 | — | 子 Agent 开始运行前触发 |
| `SubagentStop` | 子 Agent 名称 | — | 子 Agent 成功完成后触发（观察用） |
| `StopFailure` | 错误类型 | — | 本轮因错误失败后触发（观察用） |
| `Interrupt` | 空字符串 | — | 用户中断本轮时触发（例如按下 Esc）；超时或其他程序性中断不会触发。中断时 `Stop` 不会触发，由本事件替代。payload 含 `reason` 字段（观察用） |
| `PreCompact` | `manual` 或 `auto` | — | 上下文压缩开始前触发；返回值被完全忽略 |
| `PostCompact` | `manual` 或 `auto` | — | 上下文压缩完成后触发（观察用） |
| `Notification` | 通知类型（如 `task.completed`） | — | 后台任务状态变化时触发（观察用） |

## 示例：阻断危险 Shell 命令

下面的 hook 在 Agent 调用 `Bash` 工具前检查命令内容，发现 `rm -rf` 就阻断：

```toml
[[hooks]]
event = "PreToolUse"
matcher = "Bash"
command = "node ~/.kimi-code/hooks/block-dangerous-bash.mjs"
timeout = 5
```

```js
// block-dangerous-bash.mjs
// 从 stdin 读取 CLI 传来的事件数据
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);         // 解析事件数据
  const command = payload.tool_input?.command ?? '';

  if (command.includes('rm -rf')) {
    // 通过 stderr 说明阻断原因，退出码 2 表示阻断
    console.error('检测到危险命令，已阻断');
    process.exit(2);
  }
  // 正常退出（退出码 0）表示放行
});
```

阻断后，Kimi Code CLI 会把阻断原因写回上下文，模型可以据此选择更安全的替代方案。

::: warning 注意
此示例仅演示阻断机制，不是生产级的安全解析器。真实场景更适合用白名单，或用专门的 Shell 解析器处理引号、变量展开和多段命令。
:::

## 下一步

- [配置](#配置) — `[[hooks]]` 在 `config.toml` 中的完整字段声明
- [Agent 与子 Agent](./agents.md) — 利用 `SubagentStop` 事件在子 Agent 完成后触发通知
