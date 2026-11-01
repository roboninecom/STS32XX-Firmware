<!-- translation-navigation -->
[English](../../../en/tools/settings/README.md) · [Русский](../../../ru/tools/settings/README.md) · [Español](../../../es/tools/settings/README.md) · [Français](../../../fr/tools/settings/README.md) · [Deutsch](../../../de/tools/settings/README.md) · [Português (Brasil)](../../../pt-BR/tools/settings/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/settings/README.md) · [हिन्दी](../../../hi/tools/settings/README.md) · [العربية](../../../ar/tools/settings/README.md)

[英文原文](../../../../../tools/settings/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="discovery-calibration-and-settings"></a>
# 发现、校准和设置

找到 STS 伺服系统并备份或恢复其持久的旧设置。使用存储库的共享驱动程序和 STS 控制表。需要 Node.js 20 或更高版本。在 `npm ci` 之后从存储库根运行这些命令。

<a id="discover"></a>
## 发现

```sh
npm run settings -- discover --port /dev/cu.usbmodemYOUR_ADAPTER
```

列出响应的电机 ID 和报告的警报为 JSON。 Discovery 为 read-only 并扫描所选波特率，默认为 1,000,000。添加`--baud 500000`以获得不同的支持速率。在 Linux 或 Windows 上，使用适配器的端口，例如 `/dev/ttyUSB0` 或 `COM3`。

电机必须具有唯一的 ID。 Discovery 无法可靠地区分共享 ID 的电机，或查找使用其他波特率的电机。

<a id="back-up"></a>
## 备份

```sh
npm run settings -- backup --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

Saves device identity and every persistent setting described by the shared control table, including calibration, limits, gains, ID and baud selector.备份仅读取电机。现有文件永远不会被覆盖。如果没有 `--file`，则会在 `tools/settings/backups/` 下创建带时间戳的文件，该文件会被 Git 忽略。

<a id="restore"></a>
## 恢复

仅连接正在恢复的电机、禁用扭矩、锁定设置并清除活动警报。关闭使用该端口的其他程序。使用同一电机的备份：恢复另一个电机的校准可以更改其报告的位置。

```sh
npm run settings -- restore --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

`--id`和`--baud`描述**当前连接**。备份可能会恢复不同的ID或波特率；该工具会跟踪这些更改并报告最终连接。 It checks model identity, writes only changed settings, waits for each saved register range to finish, reads the settings back and relocks the motor.它从不启用扭矩或发送运动命令。恢复失败可能会导致某些设置发生更改；重试之前检查错误。

这些备份涵盖旧设置，而不是扩展配置或恢复出厂设置模板。如需通过自定义固件刷写出厂固件后进行修复，请使用[出厂设置恢复工具](../flash/README.md#restore-factory-settings)。它的备份文件使用不同的格式，并且不能与该工具的JSON互换。

<a id="calibrate-joint-offsets-and-limits"></a>
## 校准关节偏移和限制

使用从 1 到 253 的唯一 ID 和机械限制关节行程来校准 1–6 电机。在位置除数为 1 的位置模式下支持 GD32 STS 型号系列 9，包括混合电机变体。 Close other serial tools.

```sh
npm run settings -- calibrate --port /dev/cu.usbmodemYOUR_ADAPTER --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Replace the example IDs with your motors.省略 `--ids` 来校准所有发现的电机，最多六个。明确的选择使其他连接的电机保持不变。没有假定关节名称、手臂几何形状或标准参考姿势。

<a id="choose-the-reference-pose"></a>
### 选择参考姿势

缩略 **校准参照方** 是您一步步抓取的物理姿势 1。工具使每个选定的发动机报告 **2048 弹着弹着**。它不识别姿势,不推断联合角度,也不从以后的扫描中计算出来。

对于新的校准, 请在机械旅行的中间点放置每个连接点, 并选择您可以复制的位置 。 包括手腕卷和抓手; 不假设抓手应该完全打开或关闭。 每次使用相同的物理姿势 。 如果机制有文件参考姿势, 请跟随它 。 对于 SO-101 , [Lerobot 校准指南和视频](https://huggingface.co/docs/lerobot/so101#calibrate) 显示 mid-travel 位置, 然后是 end-to-end 扫描 。

<a id="reference-pose-images"></a>
### 参考图示图像

**新的校准** 使用下面的指南。 标签假定通常的马达ID 1–6。 将基地向上、 上臂向上、 前臂和扶手指向前方。 将基座旋转和手腕卷在机械站之间; 将扶手架在关闭和打开之间中间。 使用实际旅行找到这些位置, 而不是未校准的计数 。

<a id="so-101"></a>
#### SO-101

![SO-101 校准参考:侧面和顶面视图,所有六个关口都贴有标签,上臂直直,前臂前臂前臂,中间手腕卷和 half-open 控制器](../../../../../tools/settings/images/so101-reference-pose.png)

<a id="so-102"></a>
#### SO-102

![SO-102 校准参考:侧面和顶面视图,所有六个关口都贴有标签,上臂直直,前臂前臂前臂,中间手腕卷和 half-open 平行平行抓抓器](../../../../../tools/settings/images/so102-reference-pose.png)

图像显示新偏移的手工位置。 图像并不确定与现有调控重力模型的兼容性。 默认查看器地图还使用不同的 wrist/gripper 参考值: 如果您校准这些阵形, 则更新绘图 。 [图像源和模型角度 ](images/README.md) 。

在查询成为 2048后,整个旅行必须装在0–4095内:最多2048的计数低于参照数,而2047则高于参照数。 几乎全转旅行的连接需要特别小心地集中。 接近终点的重复布局可能无法离开足够的房间,即使总旅行次数少于转弯。

如果您打算使用模拟器或重力模型,其角度常规必须与这种外形相匹配。 **2048 模式中不是自动零度。** 见 [查看器绘图](../simulation/README.md#models-and-calibration) 和 [重力模型要求](../../host/arm-control/models/README.md)。在重复使用其记录和模型时,保持已经核实的校准;保存设置的硬软件刷写不需要重新校准。

<a id="capture-offsets-then-limits"></a>
### 截取抵消, 然后限制

一个命令指导两个步骤:

1. **参考面貌:** 将选中的接点置于可重复的布局中,为您的机制选择可重复的布局。支持它,保持静静,按 **输入**。工具写作发动机冲抵,这样每个选定的联合写道: **2048** 然后核对保存的登记册
2. **联合限额:** 将选中的每个联合点从端移动到端。 在每个端暂停短时间; 不强制停止 。 审查最低活点、 最高、 中点和旅行计数, 然后按 **输入**工具用 **10 清 清 清 数** 内部每个测量的终点。

该表格的**Middle** 是 `(Min + Max) / 2`, 四舍五入为整数。 这是信息 : 储量限制不会将 2048 移动到中点, 也不会更改偏移值。 亚对称限制是有效的 。

如果发动机在启动时有电, 工具会要求您在释放托盘前支持此机制。 否则上面只有两个提示。 没有命令任何动作; 托盘将关闭, 保存后设置将被锁定 。

引用抓取使用数读数的中位数。 小型手动不会停止校准, 并且略微移动, 而抵消被保存不需要再次确认 。 失败设置会保存在受影响的运动旁边, 并自动重试 。 该工具在重试写入前读取, 这样缺失的确认不会导致 already-saved 设置再次写入 。 已经完成的发动机会被保存; 不需要额外确认 。

在扫描前保存偏移, 且在限制保存后不会更改 。 限制可能是在 2048 周围不对称的 。 正在跟踪 Eccoder 包装 。 穿越 0 或 4095 的距离不能作为普通限制存储, 无法在 **check** 列中显示 `crosses zero` 。 每个联合必须至少移动 64 的数, 且在保存限制前不能完全转弯 。

临时读取错误出现在受影响的运动旁边, 当有效读数恢复时会自动显示。 快速手动不会触发 speed-limit 错误。 只有在所有范围有效时才输入保存; 否则继续记录。 使用 `reset 2` 只清除 M2 的测量范围, 并再次扫描该连接, 而不重复引用步骤或其他连接 。 真正的范围跨度零 仍然需要纠正其参考位置 ; 重新设置测量不能使该物理范围适合。 所有运动错误都留在受影响的运动旁边 。 提醒或意外的托盘暂停其设置写好直到清除; 丢失的连接被重试。 会话仍然打开并保留完成的工作。 在自动重写时, 按 Ctrl+C 键取消 。

输出文件在每次运行时都被覆盖。 汽车备份保存在`backups/` 下的一个唯一的目录中, 并可用于 `settings restore` 。 报告记录参考读数、 偏移、 测量范围和完成的写作; 它不存储相片或物理连接角度 。 只有 `status: "verified"` 表示两个步骤都已完成 。

类型类型 `cancel` 或按 Ctrl+C 键停止 。 **已经以步进方式保存的偏移 1 如果步骤 2 被取消或失败;旧的限制一直保留到替换为止。** 允许运动前的完整校准。 您可以从参照方格重调相同的命令, 而不恢复先前的校准 JSON.

<a id="expected-travel-warnings"></a>
### 预期旅行警告

可选通过`--expected-ranges FILE.json`, 内含经核实的旅行计数和容度,由马达ID键入。

```json
{"1": {"counts": 2000, "tolerance": 100}}
```

这些数字只说明文件格式。 偏差显示为警告; 按 Enter 接受所测量的范围。 操作连接没有 expected-range 检查 。

记录前的完成校准设置或拟合重力补偿。 在改变偏移后, 记录将再次显示, 并更新或修改重力模型和模拟器映射。 也没有根据此命令更新。 复制另一个手臂的偏移, 或仅修改一个模型的 calibration-check 字段, 无法在计数和角度之间建立正确的关系 。

<a id="help-and-tests"></a>
## 帮助和测试

```sh
npm run settings -- --help
npm run test:settings
```

测试在不打开序列端口的情况下脱线。 命令退出时失败时处于非零状态; 空发现列表表示在选中的 Baud 上没有回复 。
<!-- /translated-content -->
