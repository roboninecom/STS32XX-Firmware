<!-- translation-navigation -->
[English](../../../en/host/arm-control/README.md) · [Русский](../../../ru/host/arm-control/README.md) · [Español](../../../es/host/arm-control/README.md) · [Français](../../../fr/host/arm-control/README.md) · [Deutsch](../../../de/host/arm-control/README.md) · [Português (Brasil)](../../../pt-BR/host/arm-control/README.md) · [简体中文](README.md) · [日本語](../../../ja/host/arm-control/README.md) · [हिन्दी](../../../hi/host/arm-control/README.md) · [العربية](../../../ar/host/arm-control/README.md)

[英文原文](../../../../../host/arm-control/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="shared-arm-controller-and-gravity-compensation"></a>
# 共享手臂控制器和重力补偿

现场遥控、调谐、named-pose重播和timed-session重播使用一台从机控制器。它处理设置、目标、测量反馈、重力和清理。 [伺服驱动器](../servo-driver/README.md)拥有数据包编码和传输。

<a id="motor-settings-files"></a>
## 电机设置文件

请参阅 [SO-101 和 SO-102 配置文件](profiles/README.md) 了解参考设置及其操作限制。

`profiles` 可能包含内联设置或相对于控制器文件的路径：

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

[示例配置文件](../../../../../host/arm-control/profile.example.json)由工具示例共享。复制它以供您自己的设置并更新参考，或内联配置文件。如果移动控制器文件，请调整其轮廓和重力路径。 Git 会忽略名为 `*.local.json` 的文件。

在控制器上以 counts/s² (1–30000) 为单位设置 `acceleration`，以毫秒 (1–255) 为单位设置 `rampTimeMs`。每个电机都可以通过其配置文件中的 `accelerationLimit` 和 `rampTimeMs` 来覆盖这些设置。配置文件是扩展RAM设置；保存的编码器偏移和行程限制保持独立。

| 简介字段 | 含义 |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | 控制器增益乘以256。 |
| `integralLimit`, `effortLimit` | 以 PWM 努力单位表示的积分和总输出限制。 |
| `velocityLimit` | 最大速度在counts/s；默认为 65535。 |
| `velocityFilterQ8` | 测量速度滤波器设置，1–255。 |
| `gravitySlewEffortPerS` | 重力作用变化的速率限制。 |
| `velocityFeedforward` | `positiveGainQ8`、`negativeGainQ8`、`effortLimit`；将所有三个归零以禁用。 |

有关完整单位和范围，请参阅[固件寄存器指南](../../DETAILED_DOCUMENTATION.md#configuration--0xa0)。这些是 per-motor 设置，而不是可切换的固件配置文件。

调整和设置应用程序使用`joints: [{ "followerId": 1 }]`；每个受控电机添加一个条目。 Named-pose 重播从记录中获取 ID，不需要 `joints` 数组。仅现场遥控和recorded-leader重播需要`leaderId`、`mapping`和可选的direction/centers；参见[远程操作映射](../../tools/teleoperation/README.md#mapping-and-control)。

<a id="enable-gravity"></a>
## 启用重力

将 `gravityModel` 添加到您现有的配置中。路径是相对于**配置文件**的，而不是相对于工作目录的。对于保存在存储库根目录中的配置：

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

此行是对完整配置的补充，而不是独立文件。为每个关注者提供经过测试的`profiles`； `effortLimit` 限制电机总输出，`gravitySlewEffortPerS` 限制重力作用力变化的速度。单独设置回转并不能启用重力。如果没有 `gravityModel`，重播会清除任何保留的重力作用，然后在没有重力补偿的情况下运行。

提供的[手臂模型](models/README.md)保留每个直立、empty-gripper手臂的校准。它们的电机系数2–4使用测量的编码器计数，包括耦合关节；电机 1、5 和 6 明确使用零。每个受控跟随器都需要一个模型，并且其术语所使用的所有关节都必须受到控制和测量。 Angle-dependent模型还为每个输入声明`encoderCalibration`：有符号的`positionCorrection`、`resolution: 1`和`reverse`（编码器反转标志）。预检将这些与电机寄存器进行比较，并在设置或扭矩启用之前拒绝不匹配。从同一臂恢复匹配的备份，或在重新校准后更新和验证模型。 2048 处的参考捕获本身并不能建立模型的物理角度；请参阅[校准指南](../../tools/settings/README.md#choose-the-reference-pose)。对于所提供的 six-motor 型号，请包括 ID 1–6 和所有六个配置文件。在更改编码器偏移、安装、几何形状或有效负载后，未经检查校准，请勿重复使用该模型。

对每个命令使用相同的配置字段：

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

这些命令仅用于预览。添加`--run`开始控制。当前配置和测量的从动位置决定重力；记录的重力值和历史增益永远不会重播。该模型在使用前经过验证，其路径和 SHA-256 哈希值包含在会话日志中。

<a id="control-behaviour"></a>
## 控制行为

1. 预检检查固件、保存的限制、运行状况、配置文件和模型输入。
2. 所有控制器工具都会继续兼容的供电会话或自动准备新的会话。匹配的轮廓保持扭矩；更改的配置文件一次应用于一台电机。全新设置可处理扭矩释放、配置和选择，然后将所有准备好的电机一起启用。
3. 在第一个运动目标之前测量、发送并确认重力。
4. 在运动和暂停期间，一次反馈传递可提供健康检查和重力计算。重力大约每 50 毫秒刷新一次。没有第二个遥测读取器或主机速度前馈回路。
5. 在正常退出时，重力会继续进行最终运动，并且剩余的固件重力会发生变化。控制器等待 200 毫秒的休息时间，并有 30 秒的完成超时时间，然后确认最终的重力更新。扭矩保持开启；固件保留最后的目标和重力作用。

对于重播和远程操作，Ctrl+C 停止新目标并遵循相同的完成顺序。相反，调整会中断批处理并尝试 torque-off。 Ctrl+C 不是紧急停止。休息意味着规划器已停止，并且每个测量位置在整个 200 毫秒间隔内保持在 one-count 范围内。并不能证明零跟踪误差； pose/session 重播也应用其配置的到达容差。

进程退出后停止刷新重力。如果随后移动手臂或其负载发生变化，则保留的力不会适应。终止的进程或断开的总线也可能使最后的目标和工作保持活动状态。

<a id="checks-and-timing"></a>
## 检查和时间安排

重力使用测量的跟随者位置，而不是请求的目标。反馈样本必须是健康的、新鲜的并且属于当前会话。每次重力更新都有自己的顺序；在下一次反馈过程中检查接受情况。在任何写入之前，所有结果都会根据模型和电机工作量上限进行检查。过多的结果是错误，而不是剪切值。

耦合测量是连续的。采集、排队和后续写入必须保持在反馈传递开始后的 100 毫秒内。下一次更新也必须在该范围内发生；延迟的读取器、记录器或总线会导致故障，而不是默默地继续旧的重力。这些是主机检查，而不是固件超时。异步I/O可以延迟检测；它们不会使主机成为 real-time 控制器。

在没有重力的情况下，大约每 250 毫秒运行一次实时运行状况检查，在有重力的情况下，大约每 50 毫秒运行一次。在保持和定时播放期间，重放每 50 毫秒使用详细的 C2 反馈；到达检查可能会更快地进行轮询。 `--compact` 替代了较小的 C1 数据包，后者省略了中间计划者位置和 PID 贡献。启动时调谐会读取所有电机的详细反馈，然后读取探头的 C2 和支持电机的C1。反馈总是共享重力阅读器。

模型错误、更新被拒绝、missing/stale反馈、失去所有权、警报和温度等于或高于60°C尝试在每个准备好的追随者上验证torque-off。报告清理失败。

一个例外是在已建立的保持期间错过了 gravity-update 截止时间：仅当两个新反馈通过确认同一会话中电机正常、静止时，控制器才会保留扭矩。运行仍然失败并报告`holdRetained: true`；它不会自动恢复。

遥测日志记录包括测量反馈和最新请求的重力effort/sequence。固件反馈在后续样本中证实了该请求；仅记录请求并不能证明接受。 `settledAt` 是主机对所请求的重力转换何时完成的保守估计。

<a id="api-and-tests"></a>
## API 和测试

`session.run` 管理输入源的串行连接、会话日志和清理。 `ArmController`接受跟随者驱动程序、配置、输入源和可选的`GravityModel`实例。使用 `await GravityModel.load(filename)` 加载模型； CLI 解析configuration-relative 路径。输入源提供`joints`、`preflight`、`describe`、`sample`、`play`；实时输入还会检查其领导者是否已断电。自动调谐可以通过同一个读取器请求其探针电机的详细反馈。 `changeProfile`验证静止控制，仅释放该电机，配置并re-enables它，然后再次确认重力。支持电机保持供电。更改后的电机会短暂失去扭矩并在重新启动时捕获其测量位置；使用支撑或机械安全的姿势来改变轮廓。配置文件错误使用正常的 all-motor 故障清理。

源通过控制器提交位置并使用其服务等待，因此长时间的暂停会继续反馈更新。

为共享控制器运行 `npm run test:arm`，为 recording/replay 运行 `npm run test:poses`，为实时控制运行 `npm run test:teleoperation`。测试使用模拟串行响应。
<!-- /translated-content -->
