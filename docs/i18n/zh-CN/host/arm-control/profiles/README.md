<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](../../../../es/host/arm-control/profiles/README.md) · [Français](../../../../fr/host/arm-control/profiles/README.md) · [Deutsch](../../../../de/host/arm-control/profiles/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/profiles/README.md) · [简体中文](README.md) · [日本語](../../../../ja/host/arm-control/profiles/README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](../../../../ar/host/arm-control/profiles/README.md)

[英文原文](../../../../../../host/arm-control/profiles/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# 手臂轮廓

参考设置为直立、empty-gripper 手臂。每个目录包含一个控制器文件和每个电机的一个配置文件，包括 PID 和方向速度前馈。两个控制器都使用电机2–4的重力模型；电机 1、5 和 6 受到零重力作用。

| 公司简介 | 重播速度 | 加速 | 适用范围 |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000counts/s；型材天花板1,500 | 10,000counts/s² | 保留调整设置。 M1运动振荡和较慢的M2偏移仍未解决。 |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000counts/s² | 当前fixed-profile比较设置。这种快速配置仍然需要硬件验证。 |

这些只是起点，而不是通用默认值或已完成调整的声明。 SO-102 配置文件使用固定 M1 D=0.0625、M6 P=4 和 100 ms 斜坡。旧的重播在移动时使用 M1 D=0.75、M6 P=16 和 180 毫秒斜坡，因此此文件不会重现旧的运行。

<a id="use"></a>
## 使用

在所选控制器文件中设置`followerPort`。保持相对轮廓和重力路径完整。从存储库根目录：

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

使用 `so101` 作为其他配置文件。第一个命令预览；第二个移动手臂并使其保持最终姿势。重播将配置文件应用于 RAM。对于远程操作，还设置 `leaderPort` 并向每个关节添加 `leaderId`、`mapping` 和任何 direction/center 覆盖；请参阅[映射指南](../../../tools/teleoperation/README.md#mapping-and-control)。

重力模型包括拟合过程中使用的编码器校准。预检要求其与连接的手臂相匹配。 **请勿复制另一个手臂的编码器偏移来满足此检查。** 校准您的手臂，拟合或调整其模型，并在 full-speed 使用之前以适度的速度验证结果。安装、连接几何形状或有效负载的更改也需要验证。参见[重力模型格式](../models/README.md)和[调整过程](../../../tools/tuning/README.md)。

这些文件没有定义通用的物理校准姿势。创建新校准之前，请遵循 [reference-pose 指南](../../../tools/settings/README.md#choose-the-reference-pose)。将所有电机设置为 2048 可再现该手臂上捕获的姿势，但受其保存的限制和跟踪误差的影响；它不会自动重现任一捆绑模型的零姿势。
<!-- /translated-content -->
