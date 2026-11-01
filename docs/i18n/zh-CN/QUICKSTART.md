<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](../es/QUICKSTART.md) · [Français](../fr/QUICKSTART.md) · [Deutsch](../de/QUICKSTART.md) · [Português (Brasil)](../pt-BR/QUICKSTART.md) · [简体中文](QUICKSTART.md) · [日本語](../ja/QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](../ar/QUICKSTART.md)

[英文原文](../../../QUICKSTART.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# 快速启动

对于 GD32F130-based STS TTL 舵机。下面的命令使用 macOS/Linux shell 语法并从存储库根运行。扩展运动工具需要固件 v9；传统重放还支持工厂固件。

<a id="1-install"></a>
## 1。安装

安装 Node.js 20+ 和 Python 3.10+；可选的模拟查看器需要 Python 3.12。

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

将端口替换为您的端口，例如 Linux 上的 `/dev/ttyUSB0`。示例使用电机 ID **1** 和波特率 **1000000**；调整这些以匹配您的伺服系统。

<a id="2-back-up-and-flash"></a>
## 2。备份和刷写

**刷写固件可能损坏伺服电机或擦除校准数据。** 固定好机构，使用稳定电源，禁用扭矩，并关闭其他使用串口的程序。刷写前必须锁定设置并清除报警。正常刷写自定义固件时，ID 唯一的电机可以保持连接：每次刷写一个 ID，不要对总线执行 power-cycle（断电重启）。恢复操作时，只能连接需要恢复的伺服电机。

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

从 **资产** 下的 [v0.1-预览版](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview)] 下载 **自定义固件 ZIP**。将其固件映像和`release.json`一起提取到`tools/flash/releases/custom/`。不要使用 GitHub 的 **源代码** 存档进行刷新。

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

出现提示时键入 `FLASH` 并保持电源连接直至验证完成。对每个电机ID重复刷写命令，每次等待验证。验证失败请参见[刷机与恢复](tools/flash/README.md)。

**出厂固件ZIP**用于恢复出厂固件，不适用于以下运动工具。解压到单独的文件夹中，刷机后按照[恢复出厂设置](tools/flash/README.md#restore-factory-settings)即可。让每个固件映像都有自己的 `release.json`。

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3。校准关节偏移和限制

对于具有有限关节行程的机构，选择要校准的电机 ID：

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

将示例 ID 替换为您的 ID；省略 `--ids` 使用所有已发现的电机（最多六个）。对于SO-101和SO-102，请参见[标记的参考姿势图像](tools/settings/README.md#reference-pose-images)。该命令有两个步骤：

1. 将每个选定的关节（包括手腕滚动和夹具）放置在机构的参考姿势中。对于没有关节的新设置，请在每个关节行程中间附近选择一个可重复的姿势。保持不动并按 **Enter** 保存偏移，以便他们在该姿势下读取 2048。
2. 将每个选定的关节从头到尾移动，在末端短暂暂停。查看实时表并按 **Enter** 保存限制。

全程支持机制；不要强制停止。扭矩保持关闭。文件会自动更新并保留电机备份。如果第二步失败，第一步的偏移量仍会保存：在启用运动之前完成校准。测量的中点不会替代捕获的参考值。 2048只是编码器参考；它没有建立模拟或重力的物理角度。参见[选择参考姿势](tools/settings/README.md#choose-the-reference-pose)。在记录姿势或拟合重力补偿之前执行此操作。经过验证的现有校准臂在 settings-preserving 刷写后无需重新校准。

<a id="4-check-communication"></a>
## 4。检查通讯情况

保持扭矩关闭。将 `--ids` 设置为连接的电机。

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` 离线。其他命令读取硬件并打印报告路径。每次使用新的遥测输出目录；如果您的电源超出默认的 8–16 V 范围，请调整 `--voltage-min` 和 `--voltage-max`。运动前检查故障和标记读数。对于factory/custom比较，请遵循[硬件测试指南](tools/hw-diff-tests/README.md)：其全套套件可移动电机并替换保存的设置和重置模板。

<a id="5-record-and-replay-poses"></a>
## 5。记录和回放姿势

在释放扭矩之前支撑机构。手动移动它，输入名称以保存每个姿势，然后输入`done`。使用手臂所需的所有电机 ID。

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

编辑`tools/poses/controller.local.json`：设置`followerPort`，为每个电机提供`profiles`条目，并选择合适的增益、力度限制、速度和加速度。示例值是说明性的。该示例引用了共享配置文件；为了您自己的利益复制该配置文件并更新其路径，或将设置内联。路径是相对于控制器文件的。首先检查保存的校准和位置限制。从机总线必须准确包含已配置的电机。重播可处理通电和未通电的电机，并自动应用更改的设置。

将 `POSES.json` 替换为记录机保存的路径：

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

第一个命令预览； `--run` 启用运动。 **正常完成后电机将通电，保持最终目标。 Ctrl+C 不是紧急停止。** 请参阅[回放设置](tools/poses/README.md#replay-poses)。

要使用电机保存的旧 PID 设置（无补偿）进行比较：

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

不需要控制器文件。省略 `--run` 即可获得 read-only 预览。有关速度和加速度设置，请参阅[旧版重播](tools/poses/README.md#legacy-replay)]。

<a id="6-enable-gravity-compensation"></a>
## 6。启用重力补偿

对于 `tools/poses/controller.local.json`，添加此 top-level 字段：

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

随附模型适用于经过校准、直立放置且**夹爪空载的 SO-ARM-102**。包括电机 1–6 和全部六个配置文件。电机 2–4 接收补偿，其余电机的补偿为零。编码器校准必须匹配；安装方式、几何结构或负载改变后，需要经过验证的模型。不要仅为了绕过不匹配检查而更改校准。对于不同的机构或校准，应拟合并验证相匹配的模型。

[SO-101和SO-102控制器配置文件](host/arm-control/profiles/README.md)包括PID、速度前馈和匹配重力模型。使用前请阅读其限制；它们与所安装的手臂的校准相关。

重放、远程操作和调谐使用相同的字段。当工具运行时，重力跟随测量的位置；退出后，只保留最后的努力。型号要求请参见[重力指南](host/arm-control/README.md)。

<a id="7-tune-and-view-motion"></a>
## 7。调整和查看运动

复制并编辑[调优计划](../../../tools/tuning/example.json)和[控制器示例](../../../tools/tuning/controller.example.json)；将计划的 `config` 路径设置为控制器文件。对于第一次运行，请使用小的安全动作，`"stage": "baseline"`和`"candidates": []`。

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

只有`run`移动硬件。遵循[调整顺序](tools/tuning/README.md#tuning-order)：基线→重力→速度前馈→P/D和过滤→积分（如果需要）→acceleration/ramp时间→组合运动→验证。

为了可视化，安装[模拟查看器](tools/simulation/README.md)，然后使用通过重播或调整打印的event-log路径：

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

对其他捆绑臂模型使用 `--model so102`。检查查看器指南中的 reference-pose 约定。该命令自动处理 macOS 窗口启动器。观察器显示测量到的运动；它不预测调整结果。对于使用单独的领导者和跟随者适配器的hand-operated控制，请参阅[远程操作](tools/teleoperation/README.md)。
<!-- /translated-content -->
