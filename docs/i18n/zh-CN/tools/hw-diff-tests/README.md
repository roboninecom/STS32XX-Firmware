<!-- translation-navigation -->
[English](../../../en/tools/hw-diff-tests/README.md) · [Русский](../../../ru/tools/hw-diff-tests/README.md) · [Español](../../../es/tools/hw-diff-tests/README.md) · [Français](../../../fr/tools/hw-diff-tests/README.md) · [Deutsch](../../../de/tools/hw-diff-tests/README.md) · [Português (Brasil)](../../../pt-BR/tools/hw-diff-tests/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/hw-diff-tests/README.md) · [हिन्दी](../../../hi/tools/hw-diff-tests/README.md) · [العربية](../../../ar/tools/hw-diff-tests/README.md)

[英文原文](../../../../../tools/hw-diff-tests/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="hardware-comparison-tests"></a>
# 硬件对比测试

比较 STS 伺服系统上的工厂固件和定制固件。该套件涵盖了传统协议、设置、运动、校准和保护。它不测试扩展协议 v9 控制。测试使用存储库的[共享驱动程序](../../host/servo-driver/README.md)。

**使用带有固定伺服系统和自由轴的专用工作台。**一些测试会进行长时间或连续移动并替换保存的设置或校准。首先备份每个舵机。保留立即断开电机电源的方法。

<a id="setup"></a>
## 设置

安装 Node.js **20 或更新版本**，然后从存储库根目录运行：

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

这些命令离线运行。 `--list` 显示每个场景的阶段、动作分类和确切名称。对所有命令选项使用 `--help`。

仅连接测试伺服系统：某些情况下使用广播。使用适配器关闭其他程序并提供合适的电机电源。默认连接是：

| 设置 | 默认 |
|---|---|
| 工厂伺服ID | `1` |
| 定制固件舵机ID | `2` |
| 波特率 | `1000000` |

使用 `--factory-id`、`--candidate-id` 和 `--baud` 设置不同的值。 ID 必须不同；保留 ID **250 和 251** 不使用，因为测试暂时使用它们。从扭矩关闭开始，设置写入锁定且无活动警报。比较运动时，使用可比较的电机、电源和负载。

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

将端口替换为您自己的端口。 Linux常用`/dev/ttyUSB0`；在 Windows 上，直接传递端口，例如 `--port COM3`。

<a id="run-tests"></a>
## 运行测试

从通信检查开始：

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

运行默认组：

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

`safe`组检查PING、寄存器读取并拒绝对read-only寄存器的写入。它不驱动电机，但会发送 WRITE 数据包。

使用 `--stage` 选择一组，或使用 `--case` 选择一个具体场景：

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` 覆盖`--stage`。集中运行使用现有的伺服设置；他们不安装全套的测试配置。如果案例无法启动，请检查其报告的先决条件。

| 许可 | 允许 |
|---|---|
| `--allow-motion` | 启用驱动器或发出运动命令 |
| `--allow-persistence-write` | 保存的设置写入、校准和 restore-defaults |
| `--allow-template-write` | 替换已保存的重置模板 |
| `--allow-current-protection` | 驱动current-protection测试；还需要动作许可 |

完整套件需要所有四个权限和初始波特率1000000：

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

添加 `--fail-fast` 以在第一个 non-passing 情况之后停止。否则，独立案例在普通故障后继续。失败的先决条件、清理失败和失去通信都会停止进一步的测试。

<a id="settings-and-cleanup"></a>
## 设置和清理

**完整套件不会恢复您的原始设置。** 它会安装保存的测试配置，并通过加载伺服电机的重置模板来完成。模板测试将该模板替换为套件设置。

这些重点测试也具有持久的影响：

- `prerequisites` 包括restore-defaults 和校准。它的偏移测试保存一个新的偏移，将显示位置放置在2048。
- `restore-defaults`加载已保存的重置模板（`0x06`），该模板可能与制造商的原始设置不同。
- `template` 将重置模板 (`0x09`) 替换为 pre-test 活动设置。该套件无法读回或恢复旧模板。

其他持久性案例尝试恢复它们更改的设置。在下次运行之前始终检查清理错误。有关备份命令和出厂恢复，请参阅[设置备份和恢复指南](../flash/README.md#restore-factory-settings)。

**Ctrl+C 不保证清理或保存报告。** 运行程序没有优雅的中断处理程序。如果必须立即停止运动，请断开电机电源；然后在继续之前验证通信、设置和扭矩状态。

<a id="compare-against-a-saved-factory-run"></a>
## 与保存的工厂运行进行比较

使用相同的案例、套件修订版、波特率和可比较的工作台条件：

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

将参考路径替换为第一次运行的报告。保留原厂ID于`--factory-id`；即使在刷新后测试相同的物理伺服系统，候选者也必须具有不同的ID。该套件不会为您改变 ID。在single-device模式下会跳过Pair-only案例。如果没有 `--reference`，single-device 传递仅检查该场景的断言，而不检查工厂等效性。

<a id="results"></a>
## 结果

报告保存在 `tools/hw-diff-tests/results/` 或`--results` 提供的目录下。 Git 会忽略结果和日志。

打开`report.json`，用于每个设备的观察、比较、传输的数据包、接收的响应和计时。检查`fatal`、`cleanupError`、`closeError`以及案例结果。

| 结果 | 含义 |
|---|---|
| `passed` | 断言和任何可用的比较已通过 |
| `mismatch` | 工厂和候选者的观察结果不同 |
| `failed` | 断言、通信或恢复检查失败 |
| `inconclusive` | 工厂没有生产出对比所需的效果 |
| `skipped` | 案件没有审理 |

退出代码**0**表示没有报告失败；跳过的案例可能会保留。 **1** 表示 argument/setup 错误或未处理的异常。 **2** 表示报告包含失败、不匹配、不确定结果或cleanup/connection-close 错误。

时序包括主机调度、USB和串行延迟；它不是固件执行时间的直接测量。在将运动差异归因于固件之前，保留报告并重现重点案例。
<!-- /translated-content -->
