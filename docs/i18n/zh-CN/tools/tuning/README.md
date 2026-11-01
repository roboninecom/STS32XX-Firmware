<!-- translation-navigation -->
[English](../../../en/tools/tuning/README.md) · [Русский](../../../ru/tools/tuning/README.md) · [Español](../../../es/tools/tuning/README.md) · [Français](../../../fr/tools/tuning/README.md) · [Deutsch](../../../de/tools/tuning/README.md) · [Português (Brasil)](../../../pt-BR/tools/tuning/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/tuning/README.md) · [हिन्दी](../../../hi/tools/tuning/README.md) · [العربية](../../../ar/tools/tuning/README.md)

[英文原文](../../../../../tools/tuning/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="automated-tuning"></a>
# 自动调试

运行一组捆绑的候选设置, 比较重复的移动和较长的搁置, 并获得 machine-readable 推荐。 使用相同的 v9 驱动程序、 控制器和校准重力模型作为重播和远程操作。 没有设置写入 EEPROM , 没有自动安装获胜的候选人 。

<a id="start"></a>
## 开始

从仓库根根,安装节点js 20+ 与 `npm install`复制 `controller.example.json` 和 `example.json` 原样旁边的 `controller.local.json` 和 `plan.local.json`设置计划 `config` 至 `controller.local.json`,然后编辑端口、运动识别号、配置、安全联合旅行配对和机制限制。示例收益和外观说明。控制器引用共享 [运动简况](../../../../../host/arm-control/profile.example.json); 复制它以适合您自己的设置,并更新其路径,或插入配置文件。包括每个支持的发动机作为 `{ "followerId": ID }` 内 `joints`;不需要领导者绘图。完成 [校准](../settings/README.md#choose-the-reference-pose) 在选择测试位置之前选择测试位置。 位置使用校正的编码器计数; 新的偏移会改变其物理含义。 在重新校准后更新测试对、 记录和重力模型。 对于重力, 添加 `gravityModel` 确切如《公约》所述 [共享控制器导航](../../host/arm-control/README.md).

该计划的 `config` 路径与计划相对。 控制器的配置和 `gravityModel` 路径与控制器文件相对。 同样的控制器配置可用于显示重播放 。 Omit `durationMs` 用于调制 : 计划拥有批量预算 。 安全启动和配置修改机制 。 修改一个配置可简要释放运动; 新建设置可释放所有配置的追随者 。

```sh
npm run tune -- inspect tools/tuning/plan.local.json
npm run tune -- preflight tools/tuning/plan.local.json
npm run tune -- run tools/tuning/plan.local.json
```

工具将支持接合点保留在已有的固态软件锁定目标上。 只有 `probeId` 移动通过已宣布的测试配对。 没有自动的 whole-arm 重新定位。 当前目标和测量的位置将被登录以比较运行。 使用经审查的当前手臂配置联合路径 。

对第一批和其后每一批使用相同的命令:

```sh
npm run tune -- run NEXT_PLAN.json
```

启动和配置更改使用 [共享控制器寿命周期](../../host/arm-control/README.md#control-behaviour)。 不要在同一个总线上运行另一个控制器 。

`inspect` 无法连接。 `preflight` 读取固件、校准、保存的限值、健康和剖面,而不改变发动机。`run` 移动它们。目标被限制在保存的位置限值上;飞行前报告有效路径。一对崩溃到一个位置不能用作调制练习。

<a id="tuning-order"></a>
## 提款令

1. **基准:** 核查校准、安全移动、温度和与现有设置的重复性。使用`stage: "baseline"`,且不使用候选人。
2. **重力:** 保持微小的反馈增益,将双向的慢动以几种姿势和至少两种速度比较。从校准模型开始。`stage: "gravity"`收集识别数据而不改变增益。
3. **速度反馈:** 校验重力后,使用一个以上速度的稳态运动比较方向速度增益。
4. **P/D 和速度过滤:** 包含高重和低重重荷,然后用较长的悬置来暴露振动。小批量元素可以比较P、D和过滤器; 校验最佳组合 held-out 双对。
5. **Integral:** 只有当长期错误仍然存在时; 比较移动准确性和长期搁置。 包括小反转 : 单是长扫就有可能错失一个阻止固定连接克服摩擦的整体限制。 除非结果支持它, 否则保持整零 。
6. **加速和斜坡时间:** 收益固定,使用`stage: "motion"`来比较加速度和以所需速度平滑。
7. **组合动作:** 重放一个运行每个连接并包含折叠配置和扩展配置的记录路径。 与支持联合固定配置一起工作的收益可以在整个机制移动时滚动。 重新检查同一路径上修改过的连接, 然后再接受它们的设置 。
8. **验证:** 冻结选定的配置, 以所需的速度和加速度重复路径, 然后保持代表姿势更长。 记录每部发动机的准确性、 超射、 沉降、 温度和输出饱和度。 在改变有效载荷或校准后重新检查 。

`stage` 限制候选字段 : `velocity` 允许 `velocityFeedforward`; `pid` 允许 `kpQ8`, `kdQ8`, `velocityFilterQ8`; `integral` 允许 `kiQ8` 和 `integralLimit`; `motion` 允许 `accelerationLimit` 和 `rampTimeMs`基准、重力和验证阶段在不改动候选数据的情况下收集数据。 P/D/I 和速度增速使用固件 Q8 单位:除以 256 输出限值仍为全批中明确供应的控制器限值。

比较增益时, 保持加速和斜坡时间固定, 并同时比较增益 。 然后以所需的速度比较运动设置 。 最大可配置加速度是 30,000 counts/s²; 可用值取决于负荷和努力限制。 请检查实际引用和测量速度: 短划线可能永远无法达到要求的速度 。

集成增益及其限制需要同时测试。 大量累积的校正可以在摩擦释放后继续驱动联合, 导致过度排除。 集成限的界限仅包含校正; 发动机总输出由 `effortLimit` 单独控制。 最好是重复捕猎会有一个稳定的剩余错误, 并报告所选设置不符合的任何精确标准 。

<a id="reuse-settings"></a>
## 重新使用设置

控制器配置文件可以是单独的 JSON 文件, 例如 `"profiles": {"1": "motor-1.json"}` 。 路径与控制器文件相对。 汽车文件包含与内线配置文件相同的字段; 可选的 `accelerationLimit` 和 `rampTimeMs` 取代共同的默认值。 重放、 电话操作和调试通过同一装载器装载这些文件。 在扩展设置期间, 设置应用到 RAM , 在 EEPROM 中未保存 。

导出控制器到包含每个马达一个文件的新目录, `controller.json`, 一个可选的 `gravity.json`, 和一个 舱单 :

```sh
npm run tune -- export CONFIG.json NEW_DIRECTORY
```

导出不连接到发动机或验证设置。使用导出 `controller.json` 与回放、远程操作或调试计划一起使用。

要应用被接受的设置并保持当前位置 :

```sh
npm run tune -- apply NEW_DIRECTORY/controller.json
```

启动手柄自动启动, 没有动力的发动机自动启动。 在现有的会话中, 只有已变换的马达会被短暂禁用, 并一次重新配置。 支持的马达会保持动力并保留现有目标。 重力模型会清除保留重力的努力 。 重力模型会自动应用其配置, 因此此命令只需应用设置而不重放即可 。

保留被接受的设置、 重力模型、 校准、 payload/mounting 描述和验证证据 。 另一臂需要自己的校准和验证。 不要恢复另一臂的编码器 。

<a id="how-a-batch-works"></a>
## 批批量是如何工作的

为了筛选,该工具运行基线  所有候选人  基线 。 每个区块在两个方向上进行每一对和速度,将第一种方法交替进行重复。 如果两个基线漂移到`driftRatio`之外, 批量的结尾是无结果的, 并保持其动力持有。 位置漂移允许一个编码器计分。 符合资格的候选人被排出等级, 最多到 `finalists` 重复不同验证对口的共享基线之间的比较。 一项建议需要通过验证并跳过基准 。

计量包括移动跟踪 RMS、 稳定位置错误和跨度、 超时、 平整时间、 全部反应时间和饱和分数。 设置要求带内有最后的连续时间; 早期过境点不算数。 如果筛选时间短于允许的安整时间加居住时间, 则将持有和安整指标报告为推迟时间。 筛选后将移动错误、 超时和饱和排行榜排行榜排行榜排行榜。 在提出建议之前,所有尺度的验证必须经过更长的时间。 使用验证的时间足够长, 以覆盖允许的安整时间和稳定的观察间隔。 计划提供了接受限制。 计划可以给出不成功但有效的响应分数; 标定样本、 提醒、 控制超速、 过后误、 支持动作、 支持动作 temperature/voltage 停止批次并使用 [共享共享失败清理](../../host/arm-control/README.md#checks-and-timing). 批次供应不合格,建议不予建议。

反馈和重力使用 [共享共享阅读器](../../host/arm-control/README.md#checks-and-timing)计划估计了电线使用,并拒绝在或上方提出的要求。 50名义容量百分比;在运行期间检查实际差距。可视化读取日志。

**换换简介会简短地消除发动机的压力。** 支持性发动机保持控制。 控制器在变化前等待休息, 并在变化后确认重力 ; 见 [配置配置修改](../../host/arm-control/README.md#api-and-tests).

已完成的端点搁置在逆转方向前被重新使用;该工具不会发送重复设置目标或添加另一个设置延迟。

正常完成会恢复配置的基线, 并保留有动力的控件, 并给予最终重力补偿。 Ctrl+C 中断调试批次和尝试 torque-off; 在中断前支持此机制 。 断开或断开的过程可能会让固件保持最后的目标。 该工具不会自动返回到休息位置 。

<a id="results-and-agent-workflow"></a>
## 成果和代理机构工作流程

在被忽略的 `tools/tuning/logs/<run>/` 目录下保存运行 :

- `events.ndjson`: 精确的 plan/configuration, 执行遗漏、 重力模型、校准、 配置变化、 命令、 测量和试验结果 。
- `summary.json`:完成状态、比较、验证和建议。

提交包含数名明确候选人的计划, 让整批人完成, 然后检查摘要。 使用原始事件为失败的标准或模糊结果进行检查。 这避免了对每个参数进行一个过程和分析。 期限预算总是对工程进行约束。 不完整的批次没有建议 。

重新配置结果或提取 steady-motion 识别窗口 :

```sh
npm run tune -- analyse tools/tuning/logs/RUN/events.ndjson
node tools/tuning/cli.js extract tools/tuning/logs/RUN/events.ndjson > tools/tuning/logs/dataset.json
node tools/tuning/cli.js fit tools/tuning/logs/dataset.json
```

采掘业需要完成 gravity/velocity 的运行, 在筛选和验证中需要双向和多速运行, 拒绝加速、饱和、 测量差和 moving-support 窗口。 适合将整个轨迹除培训和验证之外, 并使用运行时重力基础 。 它们返回未经审查的 effort-space 系数, 没有测量的联结托盘或可部署模型 。 更新模型并故意重复独立硬件检查 。

使用 [模拟模拟查看器](../simulation/README.md) 在同一事件文件上, 以在运行期间或之后检查手臂。 它不增加公共汽车流量 。

<a id="tests"></a>
## 测试

运行 `npm run test:tuning` 或 `npm test` 用于所有节点工具。 测试与运动不连接 。
<!-- /translated-content -->
