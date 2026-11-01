<!-- translation-navigation -->
[English](../../en/tools/README.md) · [Русский](../../ru/tools/README.md) · [Español](../../es/tools/README.md) · [Français](../../fr/tools/README.md) · [Deutsch](../../de/tools/README.md) · [Português (Brasil)](../../pt-BR/tools/README.md) · [简体中文](README.md) · [日本語](../../ja/tools/README.md) · [हिन्दी](../../hi/tools/README.md) · [العربية](../../ar/tools/README.md)

[英文原文](../../../../tools/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="tools"></a>
# 工具

用于使用 STS 伺服系统的实用程序。每个指南都包含设置说明、命令和硬件要求。对于应用程序开发，请使用 [Node.js 伺服驱动程序](../host/servo-driver/README.md)，可作为从此存储库构建的独立 npm 包使用。回放和遥控共享[手臂控制器和重力模型](../host/arm-control/README.md)。

对于新机制：[校准偏移和限制](settings/README.md#choose-the-reference-pose)，记录姿势，然后调整和验证补偿。重用现有姿势和重力模型时保持经过验证的校准。

| 工具 | 目的 |
| --- | --- |
| [自动调谐](tuning/README.md) | 将有限批次的设置与重复移动和更长的验证保持进行比较。 |
| [遥测查看器](simulation/README.md) | 使用捆绑的 SO-101 和 SO-102 模型查看实时遥测并播放记录；没有巴士访问。 |
| [远程操作](teleoperation/README.md) | 从hand-operated领导者控制追随者。 |
| [记录回放](poses/README.md) | 记录命名姿势；使用旧版或扩展设置重播，或播放录制的远程操作会话。 |
| [发现、校准和设置](settings/README.md) | 查找电机、校准关节偏移和限制，以及备份或恢复持久设置。 |
| [硬件对比测试](hw-diff-tests/README.md) | 在专用伺服工作台上比较工厂和自定义固件的行为。 |
| [总线基准和遥测](diagnostics/README.md) | 测量通信延迟并检查固定读数是否存在异常值。 |
| [固件刷写与恢复](flash/README.md) | 刷新自定义或捆绑的工厂固件，恢复中断的上传并修复工厂设置。 |

Node.js 工具需要 Node.js 20 或更高版本。刷新和设置恢复需要 Python 3.10 或更高版本。模拟使用 Python 3.12。在连接硬件之前，从存储库根运行命令并遵循相关指南：比较测试可以移动电机并覆盖设置，刷写可能会损坏伺服系统。

<a id="offline-checks"></a>
## 离线检查

从存储库根运行。首先安装 Node 依赖项和每个 Python 工具的要求。这些命令都不会打开串行端口或移动硬件。

| 命令 | 覆盖范围 |
| --- | --- |
| `make verify` | 固件构建、C 回归测试、register/storage 合同和图像布局。请参阅[工具链设置](../firmware/README.md)。 |
| `npm test` | 驱动程序、共享控制器和所有 Node.js 工具。 |
| `npm run test:driver-package` | 使用缓存的 npm 依赖项打包驱动程序并进行隔离安装。 |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | 使用模拟串行设备进行刷新和恢复出厂设置。 |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | 模型，记录读者和观众的行为。 |

硬件对比使用[专用工作台套件](hw-diff-tests/README.md)；它可以替换设置并重置模板。使用[诊断](diagnostics/README.md)在组装机构上进行通信和固定遥测。
<!-- /translated-content -->
