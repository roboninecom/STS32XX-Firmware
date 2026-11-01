<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[英文原文](../../../README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX 固件

GD32F130-based STS3215 伺服系统的固件。标准STS命令在传统模式下可用；扩展模式增加了本地规划的平滑运动、可配置的位置控制、速度前馈和host-calculated重力补偿。

从 **[快速入门](QUICKSTART.md)** 指南开始，或阅读[详细文档](DETAILED_DOCUMENTATION.md) 了解配置和协议详细信息。

[![概述：记录了SO-101和SO-102before-and-after测试](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[在 YouTube 上观看](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

近似值描述了记录的演示，不保证整个工作空间的准确性。

选择视频图像或其下方的 YouTube 链接即可观看无声剪辑。所有文档视频均可通过链接获取（未列出）；还提供MP4副本。

- [为什么我们建造它](#why-we-built-it)
- [控制方式的变化](#what-changes-in-control)
- [结果SO-101 / SO-102](#results-on-so-101--so-102)
- [机器人和链接](#robots-and-links)
- [快速启动](#quick-start)
- [详细文档](#detailed-documentation)

<a id="why-we-built-it"></a>
## 我们为什么建造它

机器人手臂可以始终返回到同一点，但仍然会错过命令的目标。 **可重复性**描述了一致性； **绝对定位精度**描述了手臂距离目标的距离有多近。

**用指标衡量的重复回报**

[![用指标衡量重复收益](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[在 YouTube 上观看](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**重复性与绝对定位精度**

[![重复精度和绝对定位精度的概念解释](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[在 YouTube 上观看](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

我们尝试通过调整库存固件上的PID来减少定位误差。在某些测试场景中，减少误差的设置也会引起振荡。我们开发了定制固件，使我们能够更好地控制运动规划和位置控制。

[![库存固件：PID调谐](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)期间振荡

[在 YouTube 上观看](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## 控制权发生了什么变化

主机发送目标和设置；每个伺服系统计划并控制自己的运动。

1. 主机发送目标和设置，并在配置后计算重力补偿。
2. 每个舵机都计划自己的 S-curve 运动。
3. 本地PID和前馈控制使用测量的位置和估计的速度调整电机输出。

[在 YouTube 上观看录制的概述](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve运动

使加速和制动更加平缓。该曲线说明了随时间变化的加速度。

[![s-curve运动](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)的概念图

[在 YouTube 上观看](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[配置与限制](DETAILED_DOCUMENTATION.md#s-curve-motion)。

<a id="pid-control"></a>
### PID控制

调整伺服系统纠正位置误差的方式。灰色曲线表示振荡；白色曲线说明了更阻尼的响应。虚线是目标。

[![pid控制概念图](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[在 YouTube 上观看](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[配置与限制](DETAILED_DOCUMENTATION.md#pid-controller)。

<a id="velocity-feedforward"></a>
### 速度前馈

根据伺服系统内部计算的计划速度添加电机输出。两条曲线随着时间的推移从左向右发展。

[![速度前馈的概念图](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[在 YouTube 上观看](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[配置与限制](DETAILED_DOCUMENTATION.md#velocity-feedforward)。

<a id="gravity-compensation"></a>
### 重力补偿

主机计算贡献，伺服电机应用它。向下的箭头代表重量；向上的箭头代表支撑。

[![重力补偿概念图](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[在 YouTube 上观看](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[配置与限制](DETAILED_DOCUMENTATION.md#gravity-compensation)。

这些解释性图形和动画是概念性的，而不是测量的硬件图。有关设置、协议详细信息和限制，请参阅[详细文档](DETAILED_DOCUMENTATION.md)。扩展客户端必须支持**协议 v9.0**；扩展设置是临时的，必须在重置或重启后再次发送。

<a id="results-on-so-101--so-102"></a>
## SO-101 / SO-102 的结果

下面的剪辑显示了对 SO-101 和 SO-102 记录的 before-and-after 测试。每次比较首先显示原始行为，然后是 custom-firmware 设置。

**SO-101：之前，然后之后**

[![SO-101记录before-and-after比较](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[在 YouTube 上观看](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102：之前，然后之后**

[![SO-102记录before-and-after比较](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[在 YouTube 上观看](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

显示的近似值描述了这些演示，不保证手臂工作空间的准确性。重复性、绝对定位精度和机械偏转是不同的测量值。

<a id="complete-coordinated-movement"></a>
### 完整协调的动作

[![完成记录SO-101动作](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[在 YouTube 上观看](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

该剪辑保留了完整记录的运动。每个舵机进行本地规划；一起发送目标本身并不能保证同时到达。

<a id="mechanical-limitations"></a>
### 机械限制

[![变速箱间隙和车架弯曲](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[在 YouTube 上观看](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

齿轮箱间隙和框架弯曲仍然影响手臂的端点位置。控制器调整并不能消除这些机械限制。验证实际机制和负载的设置；请参阅[当前限制](DETAILED_DOCUMENTATION.md#current-limits)。

<a id="robots-and-links"></a>
## 机器人和链接

有兴趣构建类似的设置吗？探索 Robonine 的 SO-ARM101 和 SO-ARM102 套件。套件内容记录在产品页面上。

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101机器人套件](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102机器人套件](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [从Robonine购买SO-ARM101套件](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [从Robonine购买SO-ARM102套件](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[探索 SO-ARM102 硬件、CAD 和 BOM](https://github.com/roboninecom/SO-ARM102)。

<a id="quick-start"></a>
## 快速启动

请遵循 **[现有快速入门指南](QUICKSTART.md)** 了解先决条件、命令、检查和刷写预防措施。其设置顺序为：

1. 安装所需工具并选择伺服端口。
2. 备份电机设置并刷新已发布的自定义固件。
3. 根据设置要求校准关节偏移和行程限制。
4. 检查通讯并关闭扭矩。
5. 记录姿势、预览重播并执行第一次运动测试。
6. 使用与手臂及其校准相匹配的模型启用重力补偿。
7. 调整并查看运动。

**刷写可能会损坏伺服系统或擦除校准。** 在继续之前，请遵循指南的功率、扭矩和恢复预防措施。

对于新的SO-101或SO-102校准，请使用现有的reference-pose图像并遵循[校准指南](tools/settings/README.md#reference-pose-images)。重复使用其记录和重力模型时，保留现有的经过验证的校准。

**SO-101参考姿势**

[![SO-101带有六个标记关节的参考姿势](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102参考姿势**

[![SO-102带有六个标记关节的参考姿势](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## 详细文档

**[详细文档](DETAILED_DOCUMENTATION.md)**涵盖配置、协议、寄存器、构建和验证。技术图表和相关视频演示出现在相应部分旁边。

- [传统模式](DETAILED_DOCUMENTATION.md#legacy-mode)
- [扩展模式如何工作](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve运动](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [校准参考姿势](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID控制器](DETAILED_DOCUMENTATION.md#pid-controller)
- [速度前馈](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [重力补偿](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [启动和停止扩展模式](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [扩展协议](DETAILED_DOCUMENTATION.md#extension-protocol)
- [扩展寄存器](DETAILED_DOCUMENTATION.md#extension-registers)
- [构建与验证](DETAILED_DOCUMENTATION.md#build-and-verification)
- [存储库布局](DETAILED_DOCUMENTATION.md#repository-layout)
- [当前限制](DETAILED_DOCUMENTATION.md#current-limits)


有关各个命令指南，请参阅 [工具](tools/README.md)；有关构建工具链，请参阅 [固件](firmware/README.md)]。
<!-- /translated-content -->
