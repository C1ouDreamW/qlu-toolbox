import { readFileSync } from 'node:fs'
import path from 'node:path'
import { desktopTarget } from '../../../packages/release-contract/update-contract.mjs'
import { validateBuildInformation } from '../../../packages/release-contract/channel-contract.mjs'

export function readDesktopBuildInformation(appPath: string, packaged: boolean, platform: string, arch: string) {
  const metadata = packaged ? 'lumatile/build-info.json' : 'apps/desktop/python/lumatile/build-info.json'
  const info = validateBuildInformation(JSON.parse(readFileSync(path.join(appPath, metadata), 'utf8')))
  if (info.target !== desktopTarget(platform, arch).id) throw new Error('构建目标与当前主机不一致，请使用本平台原生版本')
  if (!packaged && info.channel !== 'debug') throw new Error('本地开发请先运行 npm run dev，使用独立 Debug 数据空间')
  return info
}

export function configureDesktopIdentity(app: Pick<import('electron').App, 'setName' | 'setPath' | 'getPath'>, information: ReturnType<typeof validateBuildInformation>) {
  if (information.channel !== 'stable') {
    app.setName(information.productName)
    app.setPath('userData', path.join(app.getPath('appData'), information.dataNamespace))
  }
}
