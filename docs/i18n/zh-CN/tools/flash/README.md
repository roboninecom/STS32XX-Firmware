<!-- translation-navigation -->
[English](../../../en/tools/flash/README.md) · [Русский](../../../ru/tools/flash/README.md) · [Español](../../../es/tools/flash/README.md) · [Français](../../../fr/tools/flash/README.md) · [Deutsch](../../../de/tools/flash/README.md) · [Português (Brasil)](../../../pt-BR/tools/flash/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/flash/README.md) · [हिन्दी](../../../hi/tools/flash/README.md) · [العربية](../../../ar/tools/flash/README.md)

[英文原文](../../../../../tools/flash/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="flash-firmware"></a>
# 闪存固件

在兼容的 **GD32F130 STS TTL 伺服电机**上刷新自定义或工厂固件。一个上传者可以处理这两件事；发布清单选择应用程序检查。

**警告：刷新固件可能会损坏您的伺服电机、擦除校准或使其无法使用。使用此工具的风险由您自行承担。无法保证康复。**

使用发布者的固件映像和匹配的`release.json`，保存在同一文件夹中。不支持原始固件版本。在刷新之前检查该版本的硬件兼容性。

<a id="install"></a>
## 安装

需要 **Python 3.10 或更高版本**。从存储库根运行：

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

在 Windows 上，请改为使用 `tools\flash\.venv\Scripts\Activate.ps1` 激活。

<a id="choose-firmware"></a>
## 选择固件

| 固件 | 清单 |
| --- | --- |
| 自定义扩展 v9 | 将发布者的图像和`release.json`一起下载到`tools/flash/releases/`。 |
| 工厂**SCServo21-GD32-TTL3.10**，型号**9.3** | 捆绑在 [`factory/release.json`](../../../../../tools/flash/factory/release.json)，与其图像一起。 |

出厂镜像仅用于匹配硬件。将选定的清单与`inspect`、`flash`或`recover`一起使用；不需要单独的工厂命令或模式。

<a id="prepare"></a>
## 准备

- 正常刷写仅重置所选电机ID。具有唯一 ID 的电机可以保持连接；当其他程序正常运行时，它们会按顺序刷写。在传输过程中请勿power-cycle乘坐总线或运行其他上传器。
- 对于**恢复**，仅连接预期的伺服系统。恢复不会通过 ID 选择电机，并且不会处理引导加载程序传输。
- 确保机构安全，使用稳定的电机电源，并使用串口关闭其他程序。
- 对于正常刷写，请使用常用的控制工具禁用扭矩、锁定设置写入并清除任何活动警报。了解舵机当前ID和波特率。
- 备份重要的校准和设置。从保存到伺服电机的设置开始；临时更改可能会在重新启动后消失。

将端口和 ID 替换为您的值。默认波特率为**1,000,000**；例如，如果需要，添加 `--baud 500000`。典型端口为 macOS 上的 `/dev/cu.usbmodem…`、Linux 上的 `/dev/ttyUSB0` 和 Windows 上的 `COM3`。

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

为这个精确的伺服系统保留这个备份。现有的备份文件不会被覆盖。

<a id="flash"></a>
## 刷写灯

检查并刷新下载的自定义版本：

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

要安装捆绑的工厂固件，请选择其清单。隔离此操作的伺服：工厂启动可能会将其ID更改为1，与总线上的另一个电机冲突。

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` 检查文件大小、校验和和清单，无需连接到伺服电机。出现提示时输入 `FLASH`。保持电源连接直到命令完成。该工具检查伺服系统，保存其设置快照，上传固件，然后检查应用程序并比较设置。验证成功后，扭矩将被禁用。

工厂刷新后，该工具会检查之前的 ID/baud，然后根据需要以 **1,000,000** 波特率检查 ID **1**，并打印工作连接。退出代码 **2** 表示工厂固件已响应但设置已更改。继续下面的设置修复而不是再次刷写。

<a id="recover-an-unresponsive-servo"></a>
## 恢复无响应的伺服系统

首先检查电源、接线、ID和波特率。如果需要恢复，请**仅连接需要恢复的伺服电机**并使用选定的清单。例如，要使用出厂固件进行恢复：

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

确认后，**power-cycle出现提示时伺服电机**，保持USB适配器连接。该工具等待引导加载程序长达 60 秒。

使用恢复后预期的ID和波特率。 Recovery无法在上传前检查当前型号或备份设置，因此请自行确认硬件兼容性。在启用扭矩之前检查校准和位置限制。

<a id="restore-factory-settings"></a>
## 恢复出厂设置

返回工厂固件后，即使设置最初看起来正确，也要恢复该伺服电机的备份。当出厂固件保存的设置无效时，可能会使用built-in默认值；普通的寄存器写入可能无法解决此问题。

使用刷写后打印的**当前** ID/baud。例如，如果现在答案为 ID 1：

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

输入 `RESTORE` 进行确认。这支持工厂 **3.10** 并拒绝检测到的自定义固件。它恢复设置，**替换保存的重置模板**，修复保存的设置，锁定写入并重新启动伺服电机。它会跟踪任何 ID/baud 更改并验证回读，而无需发送运动命令。

然后**power-cycle伺服**并使用**恢复**ID/baud进行验证：

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

保持扭矩关闭直至验证通过。您还可以提供包含 before-flash 快照作为 `--file` 的普通闪存 `report.json`。设置丢失后进行的备份无法恢复原始校准。如果没有有效的备份，请获取准确模型的设置并重新校准该伺服系统。

发生故障时，修复会尝试重新锁定设置，但不会撤消部分写入或自动重试修复。在调查之前保存报告。

<a id="results-and-options"></a>
## 结果和选项

Flash报告保存在`backups/flash/`下； `backups/settings/`下的设置报告。两者都包含可用的设置快照。成功上传包括应用程序检查；它不会读回完整的固件映像。设置不会自动恢复。

- `--output DIRECTORY`：选择报告的保存位置。
- `--yes`：跳过确认提示；所有检查仍在运行。
- `--help`：显示命令选项。

如果文件验证失败，请获取匹配的版本对。如果刷写中断，伺服可能需要恢复。如果传输完成但验证失败，请检查报告并检查ID、波特率和设置，然后重试。

对于发布作者，[release.example.json](../../../../../tools/flash/release.example.json) 显示自定义清单和 [factory/release.json](../../../../../tools/flash/factory/release.json) 工厂清单。自定义示例不是可用的固件版本。

<a id="acknowledgments"></a>
## 致谢

刷写和恢复工具的灵感来自于[0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/)。
<!-- /translated-content -->
