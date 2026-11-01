<!-- translation-navigation -->
[English](../../../en/tools/diagnostics/README.md) · [Русский](../../../ru/tools/diagnostics/README.md) · [Español](../../../es/tools/diagnostics/README.md) · [Français](../../../fr/tools/diagnostics/README.md) · [Deutsch](../../../de/tools/diagnostics/README.md) · [Português (Brasil)](../../../pt-BR/tools/diagnostics/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/diagnostics/README.md) · [हिन्दी](../../../hi/tools/diagnostics/README.md) · [العربية](../../../ar/tools/diagnostics/README.md)

[英文原文](../../../../../tools/diagnostics/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="bus-benchmark-and-telemetry-diagnostics"></a>
# 总线基准和遥测诊断

用于 STS 伺服系统的两个 command-line 工具：测量通信性能并检查固定遥测是否有异常读数。需要 Node.js 20 或更高版本。从存储库根目录，使用 `npm install` 安装依赖项。

保持电机静止，关闭扭矩并锁定设置。停止使用串行端口的其他程序。这两种工具在运行之前和之后都会检查所选的伺服系统。两者都不能启用扭矩、移动电机、刷新固件或保存设置。

<a id="bus-benchmark"></a>
## 公交车标杆

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

默认情况下，测量不同大小的 PING 和 READ 请求。每个案例都会运行 20 次预热尝试，然后对每个电机进行 1,000 次测量尝试。电机顺序在轮次之间轮换。失败的尝试仍然是失败；重试永远不会取代它们。

有用的选项：

- `--list`：列出不开放端口的情况。
- `--cases ping,read-table-87`：运行选定的案例。
- `--warmup 20`、`--repetitions 1000`：每个案例和电机的尝试次数。
- `--gap-ms 1`：请求之间暂停；默认是不添加暂停。
- `--results DIR`：输出父级；默认为 `tools/diagnostics/results`。
- `--include-writes`：还对RAM寄存器51–54的已确认写入进行基准测试。这些寄存器在其他固件上没有记录；仅在经过验证的兼容伺服系统上使用此选项。原始值在完成、失败或正常中断时恢复。必须启用写入确认。

每次运行都会创建一个包含 `summary.csv`、`report.json` 和 `samples.jsonl` 的新目录。摘要包括中值、p95、p99 和最大延迟，以及超时和错误计数。原始记录包括热身和清理交换。

延迟从串行写入调用到匹配的解码回复。包括USB和operating-system延误；它不是 firmware-only 响应时间或最大总线容量的测量。超时单独计算，不包含在延迟百分位数中。

<a id="telemetry"></a>
## 遥测

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

从寄存器 56 开始读取 17 字节，每个电机每轮读取一次。默认为每个电机 100,000 样本，不添加暂停。每次运行使用新的输出目录；现有的示例文件永远不会被覆盖。

- `--interval-ms 20`：回合开始之间的最小间隔。错过的时隙将被跳过并计入`missedDeadlines`；延迟回合不会导致爆发。
- `--gap-ms 1`：相反，在每个电机请求后暂停。不能与`--interval-ms`组合。
- `--voltage-min 5.5 --voltage-max 8.4`：预期电压范围（以伏特为单位）；默认为 8–16 V。为连接的电机和电源设置此值。

输出：`samples.csv`包含每次尝试，`anomalies.jsonl`包含标记的读数和原始交换，`report.json`包含计数、范围、计时统计和before/after设置。 CSV 电压为十分之一伏；位置、速度、电流和力度保留其原始寄存器单位。

检查标记电压和温度变化、不可信的读数、非零状态和扭矩关闭时的工作量。温度尖峰检测需要连续3次有效回复；丢失或无效的回复会破坏顺序。这些标志标识要检查的读数，而不是固件或传感器故障的证据。相同的静态读数是正常的，并不能证明数据过时。

<a id="common-options-and-tests"></a>
## 常见选项和测试

这两个工具都接受 `--baud 1000000`、`--timeout-ms 100` 和 `--help`。 ID默认为`1,2`；指定实际连接的电机。串行写入耗尽后，回复超时开始。超时后，工具会等待安静的总线，然后再继续，因为回复不包含序列号。

Ctrl+C 停止运行并执行清理。错误、不完整的运行和标记的样本会产生非零退出代码。 Git 会忽略 `results/` 下的结果。

```sh
npm run test:diagnostics
```

这些离线测试不连接到硬件。
<!-- /translated-content -->
