<!-- translation-navigation -->
[English](../../../en/tools/poses/README.md) · [Русский](../../../ru/tools/poses/README.md) · [Español](../../../es/tools/poses/README.md) · [Français](../../../fr/tools/poses/README.md) · [Deutsch](../../../de/tools/poses/README.md) · [Português (Brasil)](../../../pt-BR/tools/poses/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/poses/README.md) · [हिन्दी](../../../hi/tools/poses/README.md) · [العربية](../../../ar/tools/poses/README.md)

[英文原文](../../../../../tools/poses/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="record-and-replay-poses"></a>
# 记录和回放姿势

在扭矩关闭的情况下记录命名位置，然后使用保存的旧设置或调整的扩展设置重播它们。命令从存储库根运行。

| 命令 | 输入 | 固件 |
| --- | --- | --- |
| `npm run record-poses` | 手动定位 | 工厂或定制 |
| `npm run replay` | 命名姿势或远程操作会话 | 扩展 v9 |
| `npm run replay-legacy` | 命名姿势 | 工厂或定制 v9 |

<a id="record-poses"></a>
## 记录姿势

安装 Node.js 20 或更新版本，然后从存储库根目录运行：

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

替换您的设置的端口和 ID。可选标志为 `--baud`（默认为 1000000）、`--output DIR` 和 `--timeout-ms`（默认为 1000）。

先完成[偏移与极限校准](../settings/README.md#calibrate-joint-offsets-and-limits)。记录的姿势是运动路径点；捕获名为 `home` 或 `reference` 的姿势不会改变电机校准。

1. 支撑该机构，使其在释放扭矩时不会掉落。
2. 出现确认提示时按 Enter 键。记录仪禁用所选电机上的扭矩并验证其是否已关闭。其他电机不变。
3. 移动机械装置，保持不动，然后按 Enter 键捕捉姿势。您可以输入一个唯一的名称；未命名的姿势变成`position-1`、`position-2`等。
4. 根据需要重复。输入 `done` 完成或按 Ctrl+C 中断。

记录后扭矩保持关闭状态。读取是连续的，因此每个姿势都是固定机构的快照，而不是同步运动测量。读数丢失、警报或启用的电机会停止会话。退出时，该工具会尝试再次禁用扭矩并报告任何失败的验证。

<a id="saved-files"></a>
## 已保存的文件

为每个会话在 `tools/poses/recordings/` 中创建一个新的 JSON 文件。每次成功捕获都会自动替换该文件；如果以后的捕捉失败，之前保存的姿势仍然可用。 Git 会忽略记录。

`sts-poses`版本1格式通过电机ID识别位置，而不是数组顺序：

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

文件还包括会话时间、串行端口和波特率。读取开始时的姿势时间戳记； `durationMs` 衡量完全获取。计数是有符号的报告位置，已经包括电机的偏移和方向设置，无需转换为角度。该文件没有速度、加速度或播放计时设置，也没有校准快照。 Re-record更改编码器校准后的姿势；重播无法检测到旧姿势文件使用不同的偏移量。

<a id="replay-poses"></a>
## 重播姿势

将 [replay.example.json](../../../../../tools/poses/replay.example.json) 复制到原始文件旁边，例如 `tools/poses/controller.local.json`。设置 `followerPort` 并为每个记录的电机提供一个 `profiles` 条目。 ID来自记录；不需要引导或联合映射。该示例引用共享的[电机配置文件](../../../../../host/arm-control/profile.example.json)。复制该配置文件作为您自己的设置并更新其路径，或将设置内联。所有轮廓和重力路径都相对于控制器文件。增益示例说明了格式；使用在您的机制上测试过的设置。

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

第一个命令在不更改设置的情况下预览完整路径，并报告上限为已保存限制的目标。 `--run`开始运动，包括从当前位置接近第一个姿势。仅开放从属端口。在端口打开之前，最多接受 64 MiB 的文件并进行验证。

[共享控制器](../../host/arm-control/README.md)应用配置文件，处理现有的供电会话，并在配置`gravityModel`时提供重力补偿。 **正常完成和 Ctrl+C 保持通电保持。** 故障使用控制器的清理； Ctrl+C 不是紧急停止。可选top-level`durationMs`提前结束播放；省略它即可重播整个文件。

每个姿势都在一组命令中发送。关节速度与行驶距离成比例，受重放速度和每个电机的速度限制的影响。每个电机都会生成自己的S-curve，因此到达是近似的，并且路径点不会混合。回放等待规划器完成并且所有测量位置进入`toleranceCounts`，然后开始保持。超过 `moveTimeoutMs` 的移动失败。手动记录的时间戳不设置播放速度。

| `replay`设定 | 默认 | 含义 |
| --- | --- | --- |
| `speed` | 1000 | 最大速度，1–65535编码器counts/s。 |
| `holdMs` | 1000 | 到达后暂停，0–600000毫秒。 |
| `repeat` | 1 | 通过次数，1–1000；每一次都会返回到第一个姿势。 |
| `moveTimeoutMs` | 30000 | 到达超时，1–600000 毫秒。 |
| `toleranceCounts` | 10 | 允许测量位置误差，0–32767计数。 |

<a id="replay-a-recorded-session"></a>
## 重播录制的会话

在不连接领导者的情况下重放远程操作日志：

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

记录必须包含具有领导者限制和联合映射的`preflight`，后跟具有单调时间戳和所有领导者位置的`command`事件。在当前配置中使用相同的关节映射。记录的领导者位置通过记录的领导者限制和跟随者的当前限制来映射。应用电流剖面和重力；历史设置和努力不会被重复使用。失败日志中的预期命令可能永远不会到达电机。

回放保留记录的间隙；处理延迟延长时间而不是发送 catch-up 突发。暂停期间反馈和重力更新继续。 `replay.repeat`、`moveTimeoutMs` 和 `toleranceCounts` 适用； `speed` 和 `holdMs` 仅适用于命名姿势。最后一帧必须在完成之前到达。

<a id="legacy-replay"></a>
## 旧版重播

使用电机保存的 PID 设置，无需扩展速度前馈或重力补偿。不需要控制器文件并且持久设置不变。电机需要绝对位置模式和单位编码器分辨率。

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

第一个命令预览； `--run` 移动。 ID来自姿势文件；适配器上的其他电机保持不变。自定义固件切换到传统模式。设置会短暂禁用每个选定的电机并re-enables，首先播种其当前位置。

| 选项 | 默认 | 含义 |
| --- | --- | --- |
| `--speed` | 1000 | 最大速度，1–32767编码器counts/s。 |
| `--acceleration` | 5000 | Counts/s²，100–25400是100的倍数。已保存的限制适用。 |
| `--hold-ms` | 1000 | 在每次计划的移动后保持0–600000毫秒。 |
| `--baud` | 1000000 | 适配器波特率。 |

每个姿势都使用组命令和 distance-scaled 速度来近似同时到达。目标仅限于已保存的仓位限制。播放等待内部运动轮廓完成，然后保持；它不需要零测量位置误差。持续超过 30 秒的移动失败。

完成保留最终姿势的扭矩。与扩展重播不同，**Ctrl+C 尝试 torque-off**，失败也是如此。报告清理失败。

<a id="logs-and-visualization"></a>
## 日志和可视化

两个重放命令都将日志保存在忽略的`logs/motion/`中，包括校准、源身份、命令和反馈。启动[遥测查看器](../simulation/README.md)一次，然后在另一个终端中运行重播：

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

将 `--model so101` 用于其他捆绑模型和匹配的编码器映射。扩展重播读取查看者显示的移动参考的详细反馈。为了减少流量，附加`--compact`；测量的运动和补偿保持活动状态，但阴影显示目的地而不是中间规划器位置。 PID 项和适用的补偿量也被省略。参见[反馈和时机](../../host/arm-control/README.md#checks-and-timing)。

使用 `npm run test:poses` 运行离线录制、扩展重放和旧版重放测试。
<!-- /translated-content -->
