<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](../../../es/host/servo-driver/README.md) · [Français](../../../fr/host/servo-driver/README.md) · [Deutsch](../../../de/host/servo-driver/README.md) · [Português (Brasil)](../../../pt-BR/host/servo-driver/README.md) · [简体中文](README.md) · [日本語](../../../ja/host/servo-driver/README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](../../../ar/host/servo-driver/README.md)

[英文原文](../../../../../host/servo-driver/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XX伺服驱动器

用于 STS 串行伺服系统和 STS32XX 固件 **v9 运动扩展** 的 Node.js 驱动程序。它通过一个串行连接提供发现、寄存器访问、设置操作、S-curve运动命令、重力补偿和反馈。需要 **Node.js 20 或更高版本**以及兼容的串行适配器。

旧操作使用此包中包含的 STS 控制表。扩展操作需要定制固件v9；工厂固件不提供它们。该包适用于 Node.js，不适用于浏览器 Web Serial。

<a id="install"></a>
## 安装

从这个存储库：

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

在另一个 Node.js 项目中，安装最后一个命令生成的存档：

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

这无需发布到 npm 注册表即可工作。该存档包含库、示例、README 和许可证。通过npm安装串行依赖项；不包括固件、日志和测试结果。

通用JS：

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES模块：

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

现有的存储库工具可以继续直接导入`host/servo-driver`。使用包的主要导出；内部文件路径不是其公共API的一部分。

<a id="connect-and-read"></a>
## 连接并阅读

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

根据需要使用 `/dev/ttyUSB0`、`COM3` 或适配器的实际端口。 Discovery 以选定的波特率查找响应 ID；它不会更改电机设置或扫描其他波特率。 ID 必须是唯一的。等待最高可能的 ID 和选定的波特率。 `connect()` 打开端口并发现电机； `open()` 只打开端口。总线和扩展方法需要发现的 ID。

寄存器值使用原始单位。例如，`presentVoltage: 120`表示12V。`ControlTable`描述地址、编码、范围和显示比例。 Multi-byte字段使用little-endian编码；带符号的遗留值使用符号位。

<a id="main-api"></a>
## 主要API

所有与硬件通信的操作都会返回承诺。

| API | 目的 |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover 或关闭串行连接。 |
| `servo.bus.discover()` | 刷新已知 ID 列表。 |
| `servo.bus.scan()` | 无需替换 known-ID 列表即可发现。 |
| `servo.bus.verify(ids)` | 单独 Ping 已知电机。 |
| `servo.bus.read(id, keys, options)` | 读取命名寄存器；返回一个由寄存器名称键入的对象。 |
| `servo.bus.write(id, values, options)` | 编写一个命名寄存器的对象。 |
| `servo.bus.readMany(ids, keys, options)` | 使用组请求读取多个电机。 |
| `servo.bus.syncWrite(entries, options)` | 将形状为 `{ id, values }` 的条目写入一组。 |
| `servo.bus.device(id)` | 使用 `read`、`write` 和 reset/calibration 方法获取便利对象。 |
| `servo.settings.read(id)` | 读取持久的旧设置。 |
| `servo.settings.save(id, values)` | 解锁、保存、验证和重新锁定普通设置。 |
| `servo.arm` | 访问下面的 v9 方法。 |

设置保存使用 250 毫秒请求超时。丢失写入确认后，驱动程序会等待持久性并在重试之前读回寄存器。 Already-applied 不重复写入。暂时通讯失败最多可尝试3次；持续的故障仍然会报告错误并尝试重新锁定电机。将 `{ timeoutMs }` 传递给 `settings.save` 以覆盖超时。

传统示例，对于处于位置模式且旨在移动的安全电机：

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

传统目标写入可以自动启用扭矩，具体取决于保存的设置。持久写入可以更改校准、限制或增益。更改设置之前禁用扭矩。设置API保护ID、波特率和response-level更改；使用存储库中的[设置CLI](../../tools/settings/README.md)来获得完整的backup/restore。恢复出厂设置、reset-template和校准命令通过`servo.protocol`公开；仅当需要进行这些更改时才调用它们。

<a id="v9-control-lifecycle"></a>
## v9 控制生命周期

1. 从扭矩关闭开始。读取功能和配置。
2. 当扭矩关闭时，使用 `arm.configure()` 应用经过验证的配置。
3. 选择具有新的非零会话 ID 的扩展模式。
4. 使用旧寄存器 40 启用扭矩，然后读取反馈，直到会话已准备就绪、全新、drive-enabled 和 output-ready。
5. 发送目标和重力更新。在新反馈中验证他们接受的序列号。
6. 当应用程序想要释放电机时，写入`torqueEnable: 0`。

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

此片段显示了调用； [完整的运动示例](../../../../../host/servo-driver/examples/v9-move.js)包括验证、就绪轮询、验收检查和torque-off清理。如果禁用写入确认，则旧写入需要 `expectResponse: false` 和读回验证。完整的示例会自动处理此问题。

固件保留最后一个目标并保留最新的重力作用，直到更换或禁用扭矩。没有心跳、命令超时或重力到期。 **关闭串行连接不会停止或释放电机。** 选择应用程序清理以适应机制；释放负载的手臂可能会使其掉落。传感器和电机保护在固件中保持活动状态。

扭矩启用捕获测量位置。不要使用遗留目标写入来播种扩展会话。扭矩关闭或故障结束会话；重新启动之前准备一个新会话。要选择关闭扭矩的传统模式，请使用 `arm.select(id, false, 0)`。

<a id="extension-methods"></a>
### 扩展方法

| 方法 | 结果或效果 |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` 为可识别的签名；不支持的固件可能会拒绝请求或超时。 |
| `configuration(id, options)` | 读取当前RAM配置。 |
| `configure(id, config, options)` | 写入配置并通过读回验证编码字节。 |
| `select(id, enabled, session, options)` | 准备 v9 控件，或使用 `false, 0` 选择旧模式。 |
| `setTargets(entries, session, options)` | 发送包含一到六个独特电机的广播。 |
| `updateGravity(id, command, options)` | 发送带有自己的序列号的签名重力作用。 |
| `feedback(id, options)` | 阅读一篇连贯的操作示例。 |
| `tuning(id, options)` | 阅读操作反馈以及参考动议和个人努力项。 |
| `invalidate(id)` | 外部电源循环或固件更改后清除缓存的功能；省略 ID 即可清除全部。 |

驱动程序会自动使通过其协议 API 发出的发现、ID 更改、连接更改和重置功能失效。

<a id="configuration-and-units"></a>
### 配置和单位

每个配置字段都是明确的。该对象说明了格式，而不是推荐的调整配置文件：

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| 领域 | 单位和限制 |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | 收益乘以256；整数0–65535。 |
| `effortLimit`, `integralLimit` | PWM 努力单位；总体极限1–1000，积分极限0——总体极限。 |
| `velocityLimit`，目标`speedLimit` | 编码器counts/s； 1–65535。 |
| `accelerationLimit` | Counts/s²； 1–30000，加速和制动共用。 |
| `rampTimeMs` | S-curve加速斜坡时间； 1–255女士。 |
| `velocityFilterQ8` | 滤波器系数乘以256； 1–255。 |
| 速度前馈增益 | Direction-specific增益乘以256； 0–65535。其努力上限不能超过总体上限。将增益和上限设置为零以禁用它。 |
| `gravitySlewEffortPerS` | 每秒重力作用变化； 1–10000。 |
| 目标`positionQ8` | 编码器位置乘以256； −32767×256至32767×256。 |
| `gravityEffort` | 签下PWM努力； −1000至1000。固件应用其工作量限制。 |

行程限制来自已保存的旧位置限制。固件将目标限制为活动限制。配置是RAM状态，而不是持久的调整配置文件。本地速度前馈遵循固件运动参考；该应用程序单独提供重力补偿。

扩展目标 ID 为 1–253。一个会话是1–65535。每个电机分别跟踪目标和重力序列。为每个新命令增加相应的序列，将65535包装为0；可接受最大 32767 的前向间隙。以序列 1 开始新的会话。广播完成意味着数据包已发送，而不是每个电机都接受了它。后续反馈中检查`acceptedSequence`、`gravitySequence`、`session`。

<a id="feedback-and-errors"></a>
### 反馈和错误

`feedback()` 包括以 Q8 为单位测量的 position/velocity、施加的努力、电流 ADC 增量、原始电压、验证温度、故障、会话和接受的序列。使用`fresh`、`ageMs`、`sampleSequence`、`armed`、`driveEnabled`、`outputReady`判断样本是否可用。仅当 `temperatureValid` 为 true 时，温度才可用。 `running: false`表示计划者不再移动；它不保证零位置误差。

`tuning()` 添加参考position/velocity、请求的工作量、P/D/I 项、重力工作量、速度前馈和超限计数。

读写选项包括`timeoutMs`和`rejectOnAlarm`。默认情况下，旧警报不会拒绝其他有效的回复；当警报应中止操作时通过`rejectOnAlarm: true`。输入错误包括 `RequestTimeoutError`、`MissingResponseError`、`ServoStatusError`、`SettingsVerificationError` 和 `InvalidPacketError`。其他上下文位于`error.details`；延期拒绝包括 `extensionStatus` 。

调度程序序列化请求并支持优先级和独占事务。等待命令并使用组目标进行协调运动。串行写入耗尽后，回复超时开始；运输业务有自己的最后期限。这些超时不会改变运动行为。传统数据包没有序列号，因此无法始终将异常迟到的回复与具有相同响应形状的后续请求区分开来。

Low-level 导出包括`SerialTransport`、`StsProtocol`、`RequestScheduler`、`PacketEncoder`、`PacketDecoder`、`RegisterCodec`、`RegisterLayout`、`ArmCodec`、常量和错误。它们与high-level巴士API保持分离。

<a id="runnable-examples"></a>
## 可运行的示例

从此目录中，或使用已安装包中包含的示例文件：

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

前两个例子仅供阅读。运动示例需要具有上述字段的 JSON 配置并使用 1 Mbaud。在安全、无负载的电机上运行，并可自由行程。它会在移动、错误或优雅的 Ctrl+C 后禁用扭矩。它最多等待 3 秒启动，并等待 30 秒移动。可选的最后一个参数：带符号的重力作用，默认为零。请勿用它来支撑手臂负载。

<a id="tests-and-license"></a>
## 测试和许可

从存储库根目录：

```sh
npm run test:driver
npm run test:driver-package
npm test
```

测试使用假传输并且不打开串行端口。包检查使用来自 `npm ci` 的 npm 缓存依赖项将实际存档安装在临时项目中，并验证 CommonJS/ESM 导入和示例入口点。它不发布包。如果 serial-port 绑定对于操作系统和 CPU 不可用，生产安装可能需要本机构建工具。

[MIT](../../../../../host/servo-driver/LICENSE)，版权2026STS32XX-Firmware贡献者。该许可证涵盖该驱动程序目录，包括示例和测试。它不会重新许可存储库中其他位置的固件或供应商代码。依赖项保留自己的许可证。
<!-- /translated-content -->
