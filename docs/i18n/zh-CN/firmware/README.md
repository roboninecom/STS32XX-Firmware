<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[英文原文](../../../../firmware/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# 固件来源

GD32F130固件，包括可移植的控制代码、硬件驱动程序和测试。扩展协议记录在[详细文档](../DETAILED_DOCUMENTATION.md#extension-protocol)。

| 目录 | 内容 |
| --- | --- |
| `app/` | 主循环和组件之间的协调 |
| `core/` | 控制、传感、协议、寄存器和存储 |
| `include/` | 共享 C 声明和数据类型 |
| `platform/gd32f130/` | 硬件驱动程序、启动代码、链接描述文件和供应商标头 |
| [`tests/`](tests/README.md) | C 回归测试、Python 检查和所需的装置 |

<a id="build-and-verify"></a>
## 构建并验证

从存储库根目录：

```sh
make
make verify
```

安装 `arm-none-eabi-gcc`、带有 address/undefined-behavior 清理程序的主机 C 编译器、Python 3 和 Make。对于 PATH 之外的工具链：

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

根 Makefile 委托给此目录。 `make -C firmware` 和 `make -C firmware verify` 也有效。两者都将固件映像写入存储库根目录的`build/motor-release/`，并将本机测试可执行文件写入`build/host/`。 `make clean` 删除生成的 `build/` 目录。

这些命令不会刷新硬件。使用带有 publisher-supplied 版本的 [flash 工具](../tools/flash/README.md)。主机库和command-line工具保留在[`host/`](../host/servo-driver/README.md)和[`tools/`](../tools/README.md)]下。
<!-- /translated-content -->
