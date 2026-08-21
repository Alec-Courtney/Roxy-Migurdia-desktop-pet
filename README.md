# 洛琪希桌宠

一个分享给社区使用的 Windows 洛琪希桌宠。可以拖动、点击互动，也可以播放挥手、扶帽、伸展、水弹和豪雷积雨云等动作。拖到屏幕右侧或任务栏上沿并停留两秒后，洛琪希会进入贴边状态并偶尔挥手；点击或直接拖动可以让她回来。

作者说：

由于作者本身专业是敲代码的，所以制作的比较丑，不过整体上我把控的是身材比例和脸不崩。
恕我无能，做不出太复杂的了，要是会blender建模我就整个动画直出，那绝对好看(✧∀✧)。

## 制作参考

制作由gpt-image + Practical-RIFE 4.25 和 `rife-ncnn-vulkan` 的 `rife-anime` 模型插帧
ai图片没有办法精准控制每个部位的移动之类的，所以实际的观感还是有卡顿。
在本地跑了帧生成模型做帧率补充，尽量加了一点流畅度。

仓库里保留了完整的 Electron 桌宠骨架，以及程序当前实际使用的最终动画资源。
主要参考了小说第一卷以及动画第一季第二集

## 2.0版本

新增了屏幕右侧边缘和任务栏的交互变化，使用视频生成模型优化了部分简单动作的流畅度和清晰度。
由于水弹和豪雷积雨云的动作比较复杂，难以制作，如果还有3.0版本的话会进行改进。

## 下载

| 版本 | 仓库文件路径 | 直接下载 |
| --- | --- | --- |
| 1.0 | `release/1.0/RoxyDesktopPet-1.0.0-x64.exe` | [下载 1.0](./release/1.0/RoxyDesktopPet-1.0.0-x64.exe?raw=1) |
| 2.0 | `release/2.0/RoxyDesktopPet-2.0-x64.exe` | [下载 2.0](./release/2.0/RoxyDesktopPet-2.0-x64.exe?raw=1) |

两个可执行文件均通过 Git LFS 保存。克隆仓库后请执行 `git lfs pull` 获取完整文件。

## 使用说明

仅支持 Windows 10/11 x64。右键桌宠或托盘图标可切换小、中、大、超大四档尺寸。

勾选“禁用边缘交互”后，桌宠不会再触发屏幕右侧和任务栏上沿的贴边动画；取消勾选即可恢复。该设置在重启后仍会保留。

## 技术结构

本项目基于 Electron：

- `main.js`：窗口、托盘菜单、设置和系统级交互
- `preload.js`：主进程与页面之间的安全通信
- `renderer/`：桌宠动画和鼠标交互
- `dock-geometry.js`：屏幕右侧及任务栏上沿的停靠计算
- `assets/frames-unified/`：基础姿态资源
- `assets/animations/new/`：2.0 动画、首尾帧和资源清单
- `test/`：停靠、交互恢复和动画资源测试

原始视频、抠图中间产物和人工检查文件不属于程序运行资源，不提交到仓库。

## 开发与构建

需要 Node.js 22.12 或更高版本、pnpm 11，以及 Git LFS。

```powershell
git lfs install
git lfs pull
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

生成 Windows 便携版：

```powershell
pnpm build
```

2.0 成品输出为 `release/2.0/RoxyDesktopPet-2.0-x64.exe`。已有的 1.0 成品位于 `release/1.0/RoxyDesktopPet-1.0.0-x64.exe`；本机生成的 1.0 解包目录和构建诊断也整理在 `release/1.0/`，但不提交到 Git。运行 `pnpm build` 不会覆盖它们。
