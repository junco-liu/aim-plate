# AIM 控制台

**▸ https://vexaim.cc.cd/**

浏览器直连 VEX AIM 机器人的局域网控制台。零依赖，零构建，**不需要任何后端服务器** —— 网页只是静态资源，WebSocket 由用户浏览器直接连到同一局域网内的机器人。

代码拆成 `index.html` + `css/*.css` + `js/*.js`，用 `<link>` 和经典 `<script src>` 按顺序加载。不用 ES modules 正是为了保住「下载后本地打开」这条路 —— `import` 在 `file://` 下会被 CORS 拦死。

> 请务必用 **https** 打开。原因见下方「托管方式决定能不能连上」—— 明文 http 的公网页面被 Chrome 直接拒绝访问局域网设备，且无法通过任何用户操作解除。

协议参照 [VEX-Robotics/AIM_Websocket_Library](https://github.com/VEX-Robotics/AIM_Websocket_Library) 的 Python 客户端重新实现。

## 功能

- [x] 输入机器人 IP 直接连接，实时显示电量与朝向
- [x] 摄像头画面开关（图注条上的滑动开关，`ws_img` 推送的裸 JPEG 逐帧渲染）
- [x] 移动控制：方向盘按住即走、松开即停；键盘 `WASD` 或 `↑↓←→` 平移，`QE` 转向，`空格` 急停
- [x] 灯光：单独或整体设置 6 颗灯珠颜色
- [x] 踢球：轻 / 中 / 重
- [x] AI 视觉标注：图注条上的「标注」开关在画面上叠加识别框（AprilTag 画四角，其余画外接框），
      右栏「视觉」按类别（AprilTag / 机器人 / 蓝桶 / 橙桶 / 球）勾选过滤并实时计数；
      取消勾选会下发 `tag_detection` / `model_detection` 关掉机器人端检测，从源头少发数据。
      画面下方「视觉详细信息」展开可看中心、原点、宽高、方位角、旋转角、置信度
- [x] 表情：36 个内置表情做成带预览图的宫格，可选朝向（正面 / 向左 / 向右），一键隐藏
- [x] 机器人屏幕：图注条上「画面 / 屏幕」切页。**画笔**在图版上直接画、抬笔即发；
      **图片**上传后拖动平移 + 缩放取景，量化成 N 色再发。圆外区域压斜纹标出（240×240 里
      21% 画了也看不见）。清屏可选背景色
- [x] Python 在线编辑运行：右栏切到「代码」页即是编辑器 + 控制台，行号、语法高亮、
      可拖动的编辑器 / 控制台占比、复制、全屏。运行时用 Pyodide，首次点开才下载
- [ ] 额外加入MediaPipe手势识别

## Python

右栏顶部「控制 / 代码」切页。API **与官方 [vex 库](https://github.com/VEX-Robotics/AIM_Websocket_Library) 逐名对齐** ——
方法名、参数顺序、单位、默认值都一样，官方文档和示例里的程序可以原样粘进来跑：

```python
from vex import *                 # 这两行在这里是空操作，留着只为官方示例能原样粘贴
from vex.vex_globals import *
robot = Robot()            # 页面已经握着连接，Robot() 只是绑上去，写不写都行

robot.set_move_velocity(100)      # 100% == 200 mm/s
robot.move_for(300, 0)            # 走 300 mm，默认阻塞到走完
robot.turn_for(RIGHT, 90)
print(robot.get_x_position(), robot.get_y_position())
print(robot.inertial.get_heading())
robot.stop_all_movement()
```

已实现：`move_at` `move_for` `move_with_vectors` `turn` `turn_for` `turn_to`
`stop_all_movement` `spin_wheels` `set_move_velocity` `set_turn_velocity` ·
`get_x_position` `get_y_position` `set_xy_position` `get_battery_capacity`
`is_move_active` `is_turn_active` `is_stopped` · `has_any_barrel` 等四个 ·
`robot.inertial`（朝向 / 旋转 / 横滚俯仰偏航 / 加速度 / 陀螺速率 / 校准 / 碰撞灵敏度）·
`robot.screen`（文字、绘图、表情、触摸）· `robot.kicker` · `robot.led` ·
`robot.sound` · `robot.vision` · `Timer` · `wait`。

**未实现**：回调类（`screen.pressed` / `inertial.crashed` / `Timer.event`）—— 需要把
状态轮询接成事件源；`play_local_file` 和 `robot_send_audio` —— 需要 ws_audio 上传通道；
`show_file` —— 协议里没有上传通道，这条路本来就是死的；`color_description` /
`code_description`；`get_camera_image` —— 画面已经在图版上了。

灯光和视觉筛选的第一个参数都可以是**集合**，跟文档一致：

```python
robot.led.on((LED3, LED4), RED)          # 元组，也可以是 [1, 6]
robot.led.on(3, True)                    # True 是白，None 是熄灭
robot.led.off((LED3, LED4))
robot.vision.get_data((ALL_TAGS, ALL_CARGO))    # 命中任一即算
```

编辑器的键盘：`Tab` 缩进、`Shift+Tab` 回退，两者都作用于选区触到的每一行；
`Tab` 被占用了，所以 **`Esc` 是离开输入框的出口**（不留这个口就是个键盘陷阱）。
输入 `robot.` 会弹补全，`↑` `↓` 选、`Enter` 或 `Tab` 采纳、`Esc` 关掉。
**补全名单是运行时从 Python 的 `dir()` 拉的**，不是手写表 —— 所以它不可能和
`js/robot.js` 走歧，没有第二份 API 清单需要维护。

`get_data` 的筛选参数是官方那套**描述符**（`Tagdesc` / `AiObjdesc` / `ObjDesc` /
`Colordesc` / `Codedesc`），现成的挂在 `VisionObject` 和 `AiVision` 上：`ALL_VISION`
`ALL_TAGS` `ALL_COLORS` `ALL_CARGO` `TAG0`–`TAG37` `SPORTS_BALL` `BLUE_BARREL`
`ORANGE_BARREL` `AIM_ROBOT` `AiVision.ALL_AIOBJS`。返回值**按面积从大到小排序**，
所以 `largest_object()` 就是第 0 个。`AiVisionObject` 的属性与官方同名同义：
`type`（原始类型掩码整数，不是字符串）`id` `originX/Y` `centerX/Y` `width` `height`
`area` `angle` `rotation` `score` `exists` `bearing` `classname` `color` `tag.x` `tag.y`。

`light_set` 一条只带一个灯珠键，所以元组会逐个下发 —— 这是右栏灯光按钮已在真机上
跑通的形状，不去赌多键同报文能不能被固件接受。

**与官方源码唯一一处刻意不一致**：`robot.led.on(n, ...)` 的整数编号这里是 **1–6**，
和机器人上印的编号一致。官方源码写的是 `light{n+1}` 且判定区间是 `range(0, 6)`，于是
`on(1)` 亮的是第二颗、`on(6)` 会掉进 `else` 变成全部 —— 但它自己的 docstring 例子是
`robot.led.on(1, Color.BLUE)`，指的是第一颗。源码和文档矛盾，这里以文档为准。

同步阻塞（`robot.move_for(...)` 不用写 `await`）靠 WebAssembly JSPI + `pyodide.ffi.run_sync`
实现，所以**不需要 Web Worker 和 SharedArrayBuffer**，也就不需要 GitHub Pages 给不了的
COOP/COEP 响应头。代价是**只有 Chrome / Edge 能跑**（本来 LNA 也只放行它们）。

`drive` / `turn` 是持续命令，所以程序**正常结束、报错退出、手动停止**三条路都会补发急停 ——
程序结束等于机器人停下。纯计算死循环（`while True: pass`）打不断，中断只在 `await` 点生效。

## ⚠️ 必读：托管方式决定能不能连上

Chrome 147（2026-04）起，**Local Network Access (LNA)** 把「网页访问局域网设备」纳入权限管控，且从 Chrome 147 起覆盖 WebSocket。判定依据是**地址空间**，不是 http/https：

| 页面来源 | 连 `ws://192.168.x.x` | 结果 |
|---|---|---|
| `http://localhost:8099` | loopback → local | ✅ 放行（方向是往更公开，不受限） |
| `http://192.168.x.x:8099` | local → local | ✅ 放行（同地址空间，无需权限） |
| `file://` 本地打开 | — | ✅ 放行 |
| **`https://` 公网域名** | public → local | ⚠️ **弹权限框，点「允许」后可用** |
| **`http://` 公网域名** | public → local | ❌ **直接拒绝，不弹框，无解** |

最后一行是关键：LNA 权限**只授予安全上下文**，明文 HTTP 的公网页面永远拿不到，任何用户操作都救不了。

那混合内容呢？Chrome 对目标是 **RFC1918 字面 IP**（如 `192.168.137.236`）或 `.local` 名称的本地网络请求**豁免混合内容检查**，所以 HTTPS 页面连 `ws://` 是可以的。注意：若填的是解析到内网 IP 的**域名**而非字面 IP，混合内容会先行拦截且无出路——所以本控制台请始终填 IP。

> Firefox / Safari 不实现 LNA，但它们**照常执行混合内容拦截**，因此在这两个浏览器里 HTTPS 页面连不上 `ws://`。它们需要走局域网托管或本地文件方式。

### 结论

- **Chrome / Edge**：打开 **https://vexaim.cc.cd/** ，首次连接时在「访问本地网络设备」中点<b>允许</b>
- **Firefox / Safari，或想零权限提示**：把本页放在局域网内提供服务，或下载后本地打开

本站部署在 GitHub Pages（自定义域名 `vexaim.cc.cd`，证书已签发）。若页面顶部出现黄色提示条，说明当前是 http，按提示改用 https 即可。

## 使用

1. 机器人与你的设备连入同一局域网（或直连机器人自身 AP，此时 IP 为 `192.168.4.1`）
2. 打开 **https://vexaim.cc.cd/** ，输入机器人 IP，点「连接」
3. 浏览器询问是否允许访问本地网络设备时，点「允许」
4. 拨动画面下方图注条里的「画面」开关，即可看到实时画面；用方向盘或键盘驾驶

未连接时页面上印着这几步，不需要回来查文档。

## 协议要点

四个独立 WebSocket，均无鉴权，端口 80：

| 端点 | 用途 |
|---|---|
| `ws://<ip>/ws_cmd` | 命令。JSON 序列化后以**二进制帧**发送，严格一问一答 |
| `ws://<ip>/ws_img` | 画面。发单字节 `0x01` 开流、`0x00` 关流，之后每条消息为一整张 JPEG |
| `ws://<ip>/ws_status` | 遥测。**轮询式** —— 发 `0x01` 才回一包 JSON。AI 视觉数据也在这一包里 |
| `ws://<ip>/ws_audio` | 音频上传（本控制台未使用） |

连接后第一条命令必须是 `{"cmd_id":"program_init"}`。

单位为绝对值而非百分比：移动速度 mm/s（上限 200），转向 deg/s（上限 180）。左转为负值。

### 表情和绘制是两条路

表情是机器人内置的，`show_emoji {name, look}` **一条命令**就出图，和下面那条昂贵的绘制
路径完全不是一回事。但**表情盖在绘制内容之上** —— 表情还亮着的时候去画，命令发出去了
屏幕不动。所以画笔、图片、清屏在动手之前都会先自动补一条 `hide_emoji`，省得你以为没发出去。

预览图取自 `api.vex.com`，是本项目唯一的外部资源。**没有网就加载不出来**（连机器人自己的
热点时就是这种情况），此时宫格退回只显示名字，功能不受影响 —— 表情本身在机器人里，
不依赖这些图。

### 屏幕绘制为什么不能逐像素

圆形屏幕 r=120，可见像素 **45,239 个**。`lcd_draw_pixel` 的 JSON 里只有 `x,y`、没有颜色，
用的是当前笔色，所以多色图还得在换色前插 `lcd_set_pen_color` —— 最坏近 9 万条。
ws_cmd 是严格一问一答，这条路直接死。

实际走的编码：**量化 → 逐行行程编码 → 纵向合并同 x 同宽同色的行程 → 按颜色分组**。

`lcd_draw_rectangle` 是唯一自带 `r,g,b` 又能覆盖面积的原语，但它的**描边用当前笔色、
只有填充用内联色**，1px 高的矩形会被描边毁掉。按颜色分组之后笔色和填充色永远相同，
描边落在同色填充上、无害，而 `lcd_set_pen_color` 是每色一条不是每块一条。

行程还会按可见圆逐行裁剪，圆外一条都不发。实测三色横条图 **139 块矩形覆盖圆面积的
99.4%**；纯噪声图 38,001 条 —— 这就是为什么**没有做抖动**：抖动让每个像素都和邻居不同，
行程编码彻底失效，命令数直接回到逐像素量级。

发送严格串行，一条回一条。单条往返耗时**实测得到**（第一次发送时量出来存下来），
之后的预估用真实速率，不用估计的数字。

`show_file` 那条路是死的：它要求图片已经在机器人上，而 websocket 协议里没有上传通道。

### 三个踩过的坑

**`ws_img` 必须用 `binaryType = 'arraybuffer'`。** 用 `'blob'` 时这条流会在帧解析阶段就报
`Invalid frame header` / `One or more reserved bits are on`，socket 当场死掉；只把 `binaryType`
换成 `arraybuffer`、收到后再自行 `new Blob([data])` 包一层，同一条流就完全正常。
两者只差这一个属性，已用只开 ws_img 的对照 socket 逐行比对确认。

**断链前要先发停流字节 `0x00`。** 官方 Python 客户端在退出路径里显式调 `stop_stream()`
（见 `aim.py` 的 `Robot` 退出处理）。直接掐 socket 会把机器人停在写了一半的帧上。
本页在 `closeAll()` 里补了这一步，并挂了 `pagehide` —— 关标签页是最常见的断开方式。

**`ws_status` 要收到回包才发下一次轮询。** 官方客户端是 send → 阻塞 receive → sleep，
任何时刻只有一个请求在飞。用固定 `setInterval` 打，机器人一慢请求就叠起来，
回包互相压着出来变成坏帧。本页改为从 `onmessage` 里排下一次轮询，另带 1s 看门狗。

## 本地开发

```bash
python -m http.server 8099
```

局域网内其他设备（手机等）访问时用本机的局域网 IP，例如 `http://192.168.137.1:8099` —— 这条路径不受 LNA 限制，任何浏览器都能直接用。

内置自检：在 URL 后加 `?selftest=1`，结果输出到页面日志与控制台。验证两件事 ——
重试不会在机器人上堆积 socket；`visionParse` 对状态包的解析（类型掩码、count 截断、
AprilTag 四角、方位角多项式）符合 `aim.py` 的口径；`encode()` 的行程合并生效、
矩形不越界也不落在可见圆之外、`lcd_set_pen_color` 每色只发一条。

## 界面

浅色，取自实际使用现场（明亮教室 / 白天室内）而非品类习惯。视觉世界是「图版与页边」：
摄像头画面是一块带边框、下压实心图注条的**图版**，图注条在推流时由墨黑转为印刷蓝；
图注条既是图版的状态条也是它的控制条：左端是「画面 / 屏幕」切页，右端挂着当前内容的
开关（画面、AI 标注）——控件与它的状态指示是同一个物件，贴在它所控制的那块图版上，
手机端首屏即可见；机器人屏幕是同一块图版的第二种内容，不另占版面；
控制项按印刷分组排布，靠悬挂标题加通栏细线区分，**不使用卡片**；
悬挂标题同时是折叠开关（原生 `<details>`，不写 JS），默认只有「移动」展开，
其余手动展开——右栏装了五组工具，全摊开就没法用了；把图版切到「屏幕」页会顺手展开
「屏幕」组，否则那一页没有工具可用；
左侧页边栏是全高**急停条**，方向盘中心另有一个「停」（急停冗余是有意的）。

颜色被严格隔离：黑墨 + 单一印刷蓝 `#17518C`，红色 `#B3261E` 只用于急停。
唯一的例外是画面上的 AI 标注：它叠在照片上而不是纸面上，自成一套配色（每类目标一个色相），
不参与页面的双色规则。

## 安全提示

机器人自身没有任何鉴权。本页面对局域网内任何能访问到它的人开放机器人控制权。放在公网时若不希望被陌生人打开，请在前面加一层访问控制。

## License

MIT
