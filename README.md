# 文件中转站（Transfer Station）

局域网文件浏览与管理服务：把电脑上任意目录变成手机 / 平板 / 其他电脑都能访问的「Windows 资源管理器」。基于 Node.js + Express，前端零框架（原生 HTML/CSS/JS），Windows 11 Fluent 视觉风格。

![此电脑 · 多标签页](preview/01-此电脑-多标签页.png)

## 功能

**浏览**
- 磁盘列表（「此电脑」）：卷标、文件系统、容量条、可用空间，与 Windows 一致的呈现
- 任意目录浏览，面包屑导航、前进 / 后退 / 上一级、路径直达、搜索、六种排序（名称 / 时间 / 大小，升序降序，自然排序）
- **详细信息视图**与**图标视图**双模式：名称 / 修改日期 / 类型 / 大小四列，列头点击排序；缩略图墙用于图片视频
- **多标签页**：每个标签独立目录与浏览历史，`Ctrl+T` 新建、`Ctrl+W` 关闭、中键关闭，会话自动恢复
- 导航窗格：快速访问（收藏夹）+ 此电脑（各磁盘及容量条）

**媒体**
- 图片：sharp 生成缩略图并缓存、懒加载、大图查看器、键盘与手势翻页、相邻预加载、幻灯片自动播放（3/5/10 秒）
- 视频：ffmpeg 抽帧封面、内置播放器、0.5x–2x 倍速、相邻切换
- PDF：内置查看器（全屏 / 下载），其他文件按扩展名给出彩色类型图标

**操作**
- 上传：多选、拖拽到页面、进度条、重名自动改名
- 下载：单文件下载、整个目录打包 zip
- **右键 / 长按菜单**：打开、在新标签页打开、下载、打包下载、重命名（行内编辑，`F2`）、删除（`Delete`）、复制路径、属性
- 收藏夹（服务端存储，多端同步）、备忘录（颜色标记 / 置顶）、新建文件夹
- 深色模式（首次跟随系统）、6 种主题色、紧凑模式、全屏

![详细信息视图](preview/02-详细信息-多标签页.png)
![右键菜单](preview/05-右键菜单-文件.png)
![深色模式缩略图](preview/04-深色模式-缩略图.png)

> 以上截图使用中性示例目录（`C:\Users\Public\DemoFiles`）与合成的磁盘数据拍摄，不含任何真实个人文件或路径。

## 快速开始

要求：**Node.js ≥ 18.15**（用到 `fs.statfs`），Windows 下建议装有 `ffmpeg`（缺失时仅视频封面失效）。

```bash
npm install
npm start
```

Windows 直接双击 `start.bat` 即可（会自动安装依赖并启动）。

启动后终端会打印两个地址：

```
电脑本地访问: http://localhost:3000
手机访问地址: http://192.168.x.x:3000
```

手机与电脑连同一个 WiFi，用手机浏览器打开第二个地址即可。端口可用环境变量覆盖：`PORT=3100 npm start`。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Enter` | 打开选中项 |
| `↑` `↓` | 上下移动选择 |
| `Backspace` | 返回上一级 |
| `F2` | 重命名（行内编辑） |
| `Delete` | 删除 |
| `F5` | 刷新 |
| `Ctrl+Shift+C` | 复制选中项路径 |
| `Shift+F10` / 菜单键 | 打开右键菜单 |
| `Ctrl+T` / `Ctrl+W` | 新建 / 关闭标签页 |
| `Esc` | 关闭菜单、对话框、查看器 |
| `←` `→` / 空格 | 图片查看器翻页 |

## URL 深链

`?path=` 指定目录、`view=` 指定视图、`theme=` 指定主题，可当书签用：

```
http://192.168.1.10:3000/?path=F:/photos&view=icons&theme=dark
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/list` | 目录列表（`path` `sort` `order` `search`），返回 folders / images / videos / others |
| GET | `/api/drives` | 磁盘列表：卷标、文件系统、总容量、可用空间、已用占比 |
| GET | `/api/file` | 原始文件；`download=1` 触发下载 |
| GET | `/api/thumbnail/image` | 图片缩略图（400px、缓存） |
| GET | `/api/thumbnail/video` | 视频封面（ffmpeg 抽帧、缓存） |
| GET | `/api/download/zip` | 目录打包下载 |
| POST | `/api/upload` | 多文件上传到 `path` |
| POST | `/api/mkdir` | 新建文件夹 |
| POST | `/api/rename` | 重命名 |
| POST | `/api/delete` | 删除文件或**递归**删除文件夹 |
| GET/POST/DELETE | `/api/favorites[/:index]` | 收藏夹 |
| GET/POST/PUT/DELETE | `/api/lifezone/memos[/:id]` | 备忘录 |
| GET/POST/DELETE | `/api/lifezone/photos[/:id]` | 生活区照片（后端已就绪，前端入口待接） |

## 目录结构

```
NewList/
├── server.js           后端全部逻辑（Express，端口 3000）
├── start.bat           Windows 一键启动
├── public/             前端（原生 HTML/CSS/JS，无构建步骤）
│   ├── index.html      结构 + SVG 图标 sprite
│   ├── style.css       Windows 11 Fluent 视觉
│   └── app.js          全部交互逻辑
├── preview/            README 用的界面截图
├── .cache/             缩略图缓存（运行时生成，已忽略）
└── .data/              收藏夹 / 备忘录（运行时生成，已忽略）
```

## 安全说明

- 本服务**没有任何鉴权**，且 `path` 参数接受任意绝对路径（含 `C:\`）。设计前提是**只在可信局域网内个人使用**。
- **请勿把端口映射到公网**，也勿在公共 WiFi 下开启。
- 删除为**永久删除**，不进 Windows 回收站，无法还原。仅对驱动器根目录和服务自身目录做了保护。
- `.data/` 与 `.cache/` 含本机路径、笔记与照片缩略图，已在 `.gitignore` 中排除。

## 许可证

[MIT](LICENSE) © 2026 cloudfox-open
