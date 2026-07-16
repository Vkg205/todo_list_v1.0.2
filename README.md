# FocusTodo Pro Desktop

FocusTodo Pro 的 Electron Windows 桌面版，可脱离 Chrome 独立运行。

## 启动

```bash
npm install
npm start
```

## 构建 Windows EXE

```bash
npm run build:win
```

完整 GitHub 云编译步骤参见 `BUILD_GUIDE.md`。

## 数据位置

应用数据保存在 Electron `userData` 目录下的 `todo-data.json`。卸载默认不会删除任务数据。
