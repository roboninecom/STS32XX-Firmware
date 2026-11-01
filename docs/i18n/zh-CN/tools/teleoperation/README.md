<!-- translation-navigation -->
[English](../../../en/tools/teleoperation/README.md) · [Русский](../../../ru/tools/teleoperation/README.md) · [Español](../../../es/tools/teleoperation/README.md) · [Français](../../../fr/tools/teleoperation/README.md) · [Deutsch](../../../de/tools/teleoperation/README.md) · [Português (Brasil)](../../../pt-BR/tools/teleoperation/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/teleoperation/README.md) · [हिन्दी](../../../hi/tools/teleoperation/README.md) · [العربية](../../../ar/tools/teleoperation/README.md)

[英文原文](../../../../../tools/teleoperation/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="teleoperation"></a>
# 业务 业务

通过手动移动一个无动力的领导者来移动一个有动力的追随者。 支持 1–6 配对在两辆不同的连续公共汽车上。 领导者可以使用工厂的固件; 追随者需要这个仓库的 v9 固件 。

<a id="run"></a>
## 运行运行中

安裝節点js 20 或较新,然后运行 `npm install` 从仓库 root 获取 [例如.json](../../../../../tools/teleoperation/example.json) 原为 `controller.local.json`。设置端口、保赔率和联合身份证明。此示例共享 [运动简况](../../../../../host/arm-control/profile.example.json) 使用重放和调试。 复制它以适合您自己的设置, 更新路径, 或插入您的配置。 路径与控制器文件相对。 示例收益说明格式; 使用在您的机制上测试的设置 。

预览映射而不更改任何运动设置 :

```sh
npm run teleoperate -- CONFIG.json
```

检查所报告的立场和目标,支持两个机制,并留有空间让追随者朝领导人的姿势前进。

```sh
npm run teleoperate -- CONFIG.json --run
```

每个总线必须包含其配置的ID。 两种机制都需要保存、 非空位置限制和普通位置模式的单位分辨率 。 后续设置必须锁定, 且不推迟写入 。 头扭扭必须已经关闭; 此工具永远不写给领导者 。 后续启动程序会自动处理动力和无动力的发动机 。

运行持续到 Ctrl+C, 除非您明确设置 `durationMs` 。 **正常出口保留一个有动力的控件。** 启动、重力和故障清理跟踪 [共享控制器行为](../../host/arm-control/README.md#control-behaviour)] 。

<a id="mapping-and-control"></a>
## 绘图和控制

每个`joints`条目中包括`leaderId`、`followerId`和`mapping`:

| 设置 | 含义 |
| --- | --- |
| `mapping: "angle"` | 保存从贮存界限中心移位的编码器 。 |
| `mapping: "range"` | 领导者每半次旅行到相应的随从一半,对握手有用 |
| `direction` | `1` (违约)或 `-1` 逆向移动。 |
| `leaderMiddle`, `followerMiddle` | 可选的测距中心,严格限于各自的界限内。 |

目标被限制在跟随者保存的限度内。 `angle` 以编码器计数运行, 所以它假设兼容的编码器比例和调整 。

映射中心是保存限值的中点, 与 2048 的校准参考值可能不同。 因此, 匹配校准本身不能保证在领先和跟随限制不对称时匹配目标。 在移动前预览映射 。 `leaderMiddle` 和 `followerMiddle` 覆盖中心仅用于 `range` 映射 。

提供每个追随者的简介,并共享[摩托设置](../../host/arm-control/README.md#motor-settings-files).Add `gravityModel`]中所述的acceleration/ramp设置,以[重力补偿](../../host/arm-control/README.md#enable-gravity)]。

<a id="timing-and-checks"></a>
## 时间和检查

| 任择设置 | 默认 | 含义 |
| --- | --- | --- |
| `hz` | 60 | 请求更新速率, 1–60 Hz。 错过的时段被跳过 。 |
| `maxAgeMs` | 100 | 发送前先导框架的最大年龄, 10–10000 ms。 |
| `responseTimeoutMs` | 100 | 反应和交易排队超时,25–10000 ms。 |
| `durationMs` | 无限制 | 运行持续时间, 包括控制启动, 1–86400000 ms 。 |

每个框架必须包含每个领导位置, 并在发送前留在 `maxAgeMs` 内。 忽略了错过的更新期 。 反馈、 重力和记录共享控制环 ; 实现速度取决于总线和计算机性能 。 见 [ 共享检查和计时 ](../../host/arm-control/README.md#checks-and-timing) 。

日志被忽略保存 `logs/motion/` 成为 newline-delimited JSON。它们包含配置,即所选的会话 ID、预览、预期命令、发送的框架、反馈和 stop/error 记录。 仅有命令记录并不能证明目标被发送或被接受。 正在等待写作而不积累未绑定的日志队列; 缓慢的记录可能会触发 frame-age 检查。

使用 [recorded-session 重播命令](../poses/README.md#replay-a-recorded-session)] 重放日志, 无需连接导头 。

使用 `npm run test:teleoperation` 运行脱线测试 。
<!-- /translated-content -->
