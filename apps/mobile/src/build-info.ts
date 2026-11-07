declare const __LUMATILE_BUILD__: {
  channel: 'debug' | 'alpha' | 'stable'
  version: string
  applicationId: string
  productName: string
  updatesEnabled: boolean
  telemetryEnabled: boolean
  commit: string | null
}

export const buildInformation = typeof __LUMATILE_BUILD__ === 'undefined' ? {
  channel: 'debug' as const, version: '0.0.0-debug.0', applicationId: 'io.github.c1oudreamw.lumatile.debug',
  productName: 'LumaTile Debug', updatesEnabled: false, telemetryEnabled: false, commit: null,
} : __LUMATILE_BUILD__
