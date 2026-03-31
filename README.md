# 太极路径连词游戏 (Tai Chi Path Word Connect Game)

太极路径连词是一款融合中国传统太极文化与经典“连词/找词”玩法的益智类 H5 小游戏。游戏由原生 HTML、CSS 和 JavaScript 开发，支持离线运行，并可通过 PWA (Progressive Web App) 技术安装到手机、平板等移动端设备进行游玩。

## ✨ 特色功能 (Features)

- **🧩 动态棋盘生成**: 采用深度优先搜索算法 (DFS) 能够将词库中的太极招式名称无缝、随机地布满整个棋盘。
- **⚙️ 自定义难度与词库**: 玩家可以在“设置”面板中自由切换难度（6x6 简单, 8x8 中等, 10x10 困难）并支持通过输入框自定义输入其他任何需要练习的字词组合。
- **⏱️ 倒计时挑战**: 不同难度配备了不同时长的倒计时系统，增强游戏挑战性与紧迫感。
- **💡 提示与重玩系统**: 如果暂时无法找到词语，使用“提示”功能能够帮助寻路。
- **📱 PWA 离线支持**: 游戏支持 Service Worker。玩家在浏览器端将其“添加到主屏幕”后，即可支持在无网环境下像原生 App 一样启动、游玩。
- **🎨 精美适配UI**: 以太极和中华传统文化为主题的温暖配色，布局自动响应式适配手机、平板及电脑网页浏览器。

## 🚀 运行与体验 (How to Run)

这是一个纯前端项目，无需配置复杂的开发环境。

1. **直接启动**: 双击打开 `index.html` 即可在浏览器中体验游戏。
2. **本地服务器运行** (推荐): 若要测试 Service Worker (PWA 离线功能) ，需要使用一个本地 HTTP 服务器，比如：
   - 使用 VS Code 的 [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) 插件。
   - 使用 Python 快速启动: `python -m http.server 8000` ，然后在浏览器中访问 `http://localhost:8000`。

## 📥 安装为应用 (PWA Pointers)

1. 在 Android/iOS 或电脑浏览器 (Chrome/Edge) 中打开通过 HTTP/HTTPS 协议承载的游戏链接。
2. 浏览器地址栏或菜单均会提示 **“安装应用” (Install App)** 或 **“添加到主屏幕” (Add to Home Screen)**。
3. 点击安装后，游戏即可作为独立 App 留存在您的设备桌面上。

## 📁 目录结构 (Folder Structure)

```text
├── index.html       # 游戏主页及 DOM 结构
├── style.css        # 样式文件，包括主题配色与动画效果
├── script.js        # 游戏核心逻辑，包含棋盘DFS生成及交互操作
├── manifest.json    # PWA 清单，包含应用图标及主题色等配置
├── sw.js            # PWA Service Worker 脚本，处理资源的离线缓存
└── icon.png         # 应用图标，用于 PWA 及网页 favicon
```

## 🎮 玩法指引 (How to Play)

1. 根据游戏界面上方的目标词汇（默认包含“白鹤亮翅”、“野马分鬃”等太极招式），在网格内依次相邻点击组成对应的字汇路径。
2. 只有正确的字词相连，区块才会被固定点亮（不能跳格点击）。
3. 在倒数计时结束前找出全部的隐蔽词语即为胜利！
4. 点击界面左上方的 **[设置]** 图标，您可以随意更改游戏词库或扩大网格进行深度挑战！
