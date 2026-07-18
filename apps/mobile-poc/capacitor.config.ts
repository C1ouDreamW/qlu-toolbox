import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.edu.qlu.toolbox.mobilepoc',
  appName: 'QLU工具箱移动验证',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
