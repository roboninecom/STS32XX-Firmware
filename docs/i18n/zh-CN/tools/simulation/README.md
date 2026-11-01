<!-- translation-navigation -->
[English](../../../en/tools/simulation/README.md) · [Русский](../../../ru/tools/simulation/README.md) · [Español](../../../es/tools/simulation/README.md) · [Français](../../../fr/tools/simulation/README.md) · [Deutsch](../../../de/tools/simulation/README.md) · [Português (Brasil)](../../../pt-BR/tools/simulation/README.md) · [简体中文](README.md) · [日本語](../../../ja/tools/simulation/README.md) · [हिन्दी](../../../hi/tools/simulation/README.md) · [العربية](../../../ar/tools/simulation/README.md)

[英文原文](../../../../../tools/simulation/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="telemetry-viewer"></a>
# 遥遥测查看器

在 MuJoCo 中查看实时遥测或重放控制器记录。 查看者读取日志文件; 它从不连接到发动机或发送命令。 两种模型使用相同的查看器、 图表和引用重叠。 它显示有记录的动作; 它不预测运动动态或调试结果 。

<a id="install"></a>
## 安装

从仓库根根, 使用 Python 3.12 :

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

<a id="live-and-recorded-playback"></a>
## 现场直播和录制播放

启动一次以观看最新的会话, 当另一个重播或远程操作运行创建日志时自动切换 :

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

目录必须存在。 空目录等待第一个日志。 窗口、 相机和显示首选项在运行之间保持不变; 每个新会话的图表重设。 在另一个终端中单独启动硬件重放 。

跟随一个特定的日志, 或者从开始播放一个已保存的日志 :

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

命令在 macOS 上自动选择本地窗口发射器, 包括包含空格的仓库路径 。 为 SO-102 选择 `--model so102` 。 省略时这也是默认。 模型和 meshes 被捆绑, 因此查看不需要下载或导入步骤 。

对于 PNG 预览, 在所有平台上使用普通 Python :

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

查看器接受控制器事件日志, 未命名的日志代表 JSON 文件。 请通过 [硬件重播 ](../poses/README.md#replay-poses) 发送显示文件, 然后查看由此产生的日志 。 播放会保存记录时间并保持最后框架 。 仅在完整的运动反馈通过后才进行现场显示更新 。 延迟的测量标签是淡色的; 单是命令无法刷新它们 。 必须重新打开替换或短程的日志 。 关闭该查看器会让硬件控制运行 。

<a id="models-and-calibration"></a>
## 模型和校准

| 型 型 | 来源来源来源 | 显示映图 |
| --- | --- | --- |
| `so101` | [正式官方官方官方官方 SO-101 随 随 行 者](urdf/so101/README.md)阿帕奇语 2.0 | 全部六个马达 包括手腕卷 和回流的握手下巴 |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | 现有校校校 M1–M4 绘制;手腕卷和下巴保持固定。 |

SO-101 使用上游的 `so101_new_calib.urdf`。默认映射假定采用标准装配，且每个 URDF 关节在编码器计数为 2048 时处于零位。计数增加时，每个 URDF 关节角度按每计数 2π/4096 弧度增加。这一约定必须与机械臂的参考姿态和关节方向一致；界面标注为 **假定参考姿态**，并不表示已经通过 hardware-verified 对齐验证。夹爪直接使用编码器角度，而非 LeRobot 归一化的 0–100 开合量。其 URDF 零位必须与校准参考姿态下的夹爪角度匹配，不能根据保存的行程限制推导。

SO-102 保留现有的 encoder-calibration 检查和固定的下巴连接。 改变模型不会改变硬件控制器或其重力模型 。

<a id="match-the-calibration-reference"></a>
### 匹配校准引用

[校准工具 ](../settings/README.md#choose-the-reference-pose) 设置 2048 以您所捕捉的姿势 。 查看器将这些计数分别转换为角度 :

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| 混混地图图 | 当数为 2048 时显示共显示角度 |
| --- | --- |
| SO-101 | 0全部六人为° URDF 关节; 这是假设, 不是检测到的身体姿势 。 |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1°; M5 和下巴使用固定显示位置。 |

mid-travel 校准姿势, 包括 LeRobot 指南中显示的姿势, 本身无法确定每个 URDF 角度为零。 在您捕获的引用中, 将每个映射条目的 `referenceRadians` 设置为URDF 的角。 请检查一个小手动以确认 `radiansPerCount` 的标志, 包括手腕卷和抓抓器。 检查第二个姿势; 匹配一个姿势无法确认方向或比例。 该工具无法从最小和最大计数中得出这些角度 。

SO-101 的默认映射没有精确的偏移绑定 。 SO-102 的映射与原臂保存的偏移相捆绑。 在重新校准后, 更新物理角度映射及其校准字段; 仅修改这些字段即可绕过检查而不纠正显示。 校准报告不会自动导入。 青色覆盖显示固件的配置, 或有压缩反馈的目的地; 它与校准外观分开 。

要调整或绑定地图到特定的手臂,请复制 `so101-encoder-map.json` 或 `encoder-angle-map.json`, 编辑后通过`--mapping YOUR_MAP.json`, 并使用任一命令。 版本 2 地图包含:

- `model`: 必须匹配选定的模型 。
- `joints`:绘制成URDF联合名称、`referenceCount`、`referenceRadians`并签署`radiansPerCount`的发动机身份证。
- `fixedJoints`:没有测量绘图的模型联合点位置,以回流联合点的弧度或滑动联合点的米为单位。
- `encoderCalibration`:可选择的精确per-motor `positionCorrection`、`resolution`和`reverse`设置,对照飞行前记录进行检查。

每个模型联合必须绘图或明确固定。日志中的计数已经包含 servo 的位置校正; 不再减去它。 需要单位编码器分辨率。 反向编码器需要一个明确的校准条目和匹配的签名角度映射。 使用先前格式制作的自定义地图, 请复制版本 2 并传输您的引用角度和方向。

<a id="display"></a>
## 显示显示显示

两种模型在基底都有中性背景和半透明网格平面。 网格是一个直观引用, 没有碰撞反应; 其下方仍然可见。 播放保持其最终框架, 没有循环或重新启动。 带文件的实况模式只跟随该文件。 使用一个目录, 它跟随该目录中新的 `.ndjson` 文件, 不搜索子目录, 或在更新旧日志时切换 。

`1`–`6` 选择马达; `G` 切换引用重叠; `C` 图表; `J` 联合标记; `M`/`R` measured/reference 外形; `F` 图像质量; `H` 选项。选定的连接带有错误标签。缺少读数显示 `--`.

契约 C1 反馈测量了位置,但没有规划人的参考;比较使用指定目的地。 C2 提供规划器参考的反馈。 移动过程中的目标错误不是跟踪错误。 新的重播日志使用详细的反馈: 青色阴影跟随公司软件的中间计划位置。 更老的版本是 。 compact-feedback 日志仍然显示目的地之间的跳跃; 查看器无法恢复缺失的中间引用。 图表保留到 20 秒,不编造新的测量时间戳。

查看器复制了有联系人和重力障碍的几何形状。 它不模拟运动动态或预测 PID 调试。 显示联合位置时没有固定在标称 CAD 限制下 。

<a id="tests"></a>
## 测试

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
<!-- /translated-content -->
