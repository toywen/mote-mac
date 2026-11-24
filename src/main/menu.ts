import {
  app,
  BaseWindow,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  shell
} from 'electron'
import { channels, type MenuAction } from '../core/ipc'
import { Updater } from './updater'

function sendAction(action: MenuAction, win?: BaseWindow | null): void {
  const target =
    (win instanceof BrowserWindow ? win : null) ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0]
  if (target && !target.isDestroyed()) {
    target.webContents.send(channels.menuAction, action)
  }
}

export function buildApplicationMenu(onCreateWindow?: (win?: BaseWindow | null) => void): Menu {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: '关于 mote' },
              {
                label: '检查更新...',
                click: async (_menuItem, browserWindow) => {
                  const targetWin =
                    (browserWindow instanceof BrowserWindow ? browserWindow : null) ??
                    BrowserWindow.getFocusedWindow() ??
                    BrowserWindow.getAllWindows()[0]

                  const updater = Updater.getInstance()
                  try {
                    const status = await updater.checkForUpdates()
                    if (status.state === 'not-available') {
                      if (targetWin && !targetWin.isDestroyed()) {
                        await dialog.showMessageBox(targetWin, {
                          type: 'info',
                          buttons: ['好'],
                          defaultId: 0,
                          title: '检查更新',
                          message: '当前已是最新版本',
                          detail: `mote v${status.currentVersion} 目前已是最新版本。`
                        })
                      }
                    } else if (status.state === 'error') {
                      if (targetWin && !targetWin.isDestroyed()) {
                        await dialog.showMessageBox(targetWin, {
                          type: 'warning',
                          buttons: ['好'],
                          defaultId: 0,
                          title: '检查更新',
                          message: '检查更新失败',
                          detail: status.error || '检查更新失败，请稍后重试。'
                        })
                      }
                    }
                  } catch (err: unknown) {
                    if (targetWin && !targetWin.isDestroyed()) {
                      const msg = err instanceof Error ? err.message : String(err)
                      await dialog.showMessageBox(targetWin, {
                        type: 'warning',
                        buttons: ['好'],
                        defaultId: 0,
                        title: '检查更新',
                        message: '检查更新失败',
                        detail: msg
                      })
                    }
                  }
                }
              },
              { type: 'separator' as const },
              {
                label: '偏好设置...',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  sendAction('open-settings')
                }
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '隐藏 mote' },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '全部显示' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出 mote' }
            ]
          }
        ]
      : []),

    {
      label: '文件',
      submenu: [
        {
          label: '新建笔记',
          accelerator: 'CmdOrCtrl+N',
          click: (_item, win) => sendAction('new-note', win)
        },
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: (_item, win) => {
            if (onCreateWindow) onCreateWindow(win)
          }
        },
        {
          label: '快速打开...',
          accelerator: 'CmdOrCtrl+O',
          click: (_item, win) => sendAction('quick-open', win)
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: (_item, win) => sendAction('save', win)
        },
        { type: 'separator' as const },
        {
          label: '打开笔记库...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: (_item, win) => sendAction('choose-vault', win)
        },
        {
          label: '在访达中显示笔记',
          click: (_item, win) => sendAction('show-in-folder', win)
        },
        {
          label: '用默认应用打开',
          click: (_item, win) => sendAction('open-with-default-app', win)
        },
        { type: 'separator' as const },
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, win) => sendAction('close-tab', win)
        },
        { role: 'close' as const, label: '关闭窗口', accelerator: 'CmdOrCtrl+Shift+W' }
      ]
    },

    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' },
        {
          label: '插入图片...',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (_item, win) => sendAction('insert-image', win)
        },
        { role: 'selectAll' as const, label: '全选' },
        { type: 'separator' as const },
        {
          label: '在笔记库中搜索...',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: (_item, win) => sendAction('search', win)
        }
      ]
    },

    {
      label: '格式',
      submenu: [
        {
          label: '粗体',
          accelerator: 'CmdOrCtrl+B',
          click: (_item, win) => sendAction('format-bold', win)
        },
        {
          label: '斜体',
          accelerator: 'CmdOrCtrl+I',
          click: (_item, win) => sendAction('format-italic', win)
        },
        {
          label: '删除线',
          accelerator: 'CmdOrCtrl+Shift+X',
          click: (_item, win) => sendAction('format-strike', win)
        },
        {
          label: '高亮',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: (_item, win) => sendAction('format-highlight', win)
        },
        {
          label: '行内代码',
          accelerator: 'CmdOrCtrl+`',
          click: (_item, win) => sendAction('format-code', win)
        },
        {
          label: '插入链接',
          accelerator: 'CmdOrCtrl+K',
          click: (_item, win) => sendAction('format-link', win)
        },
        { type: 'separator' as const },
        {
          label: '待办列表',
          accelerator: 'CmdOrCtrl+Enter',
          click: (_item, win) => sendAction('format-task', win)
        },
        {
          label: '无序列表',
          click: (_item, win) => sendAction('format-bullet', win)
        },
        { type: 'separator' as const },
        {
          label: '代码块',
          accelerator: 'CmdOrCtrl+Alt+C',
          click: (_item, win) => sendAction('format-codeblock', win)
        },
        {
          label: '引用',
          accelerator: 'CmdOrCtrl+Shift+.',
          click: (_item, win) => sendAction('format-quote', win)
        }
      ]
    },

    {
      label: '查看',
      submenu: [
        {
          label: '切换编辑/阅读模式',
          accelerator: 'CmdOrCtrl+E',
          click: (_item, win) => sendAction('toggle-mode', win)
        },
        {
          label: '切换侧边栏',
          accelerator: 'CmdOrCtrl+\\',
          click: (_item, win) => sendAction('toggle-sidebar', win)
        },
        {
          label: '在侧边栏中定位当前笔记',
          accelerator: 'CmdOrCtrl+Shift+J',
          click: (_item, win) => sendAction('reveal-active-file', win)
        },
        { type: 'separator' as const },
        {
          label: '切换文雅楷体/现代黑体',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: (_item, win) => sendAction('toggle-font', win)
        },
        {
          label: '切换明亮/深色主题',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: (_item, win) => sendAction('toggle-theme', win)
        },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: '实际大小' },
        { role: 'zoomIn' as const, label: '放大' },
        { role: 'zoomOut' as const, label: '缩小' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '切换全屏幕' }
      ]
    },

    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const, label: '最小化' },
        { role: 'zoom' as const, label: '缩放' },
        { type: 'separator' as const },
        {
          label: '显示下一个标签页',
          accelerator: 'Ctrl+Tab',
          click: (_item, win) => sendAction('next-tab', win)
        },
        {
          label: '显示上一个标签页',
          accelerator: 'Ctrl+Shift+Tab',
          click: (_item, win) => sendAction('prev-tab', win)
        },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const, label: '前置全部窗口' }]
          : [{ role: 'close' as const, label: '关闭' }])
      ]
    },

    {
      label: '帮助',
      submenu: [
        {
          label: 'GitHub 仓库',
          click: () => {
            void shell.openExternal('https://github.com/toywen/mote-mac')
          }
        },
        {
          label: '汇报问题...',
          click: () => {
            void shell.openExternal('https://github.com/toywen/mote-mac/issues')
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
