import { rename, chmod, unlink } from 'fs/promises'
import { getVersionInfo, CURRENT_VERSION } from './version.ts'

const GITHUB_REPO = 'blpsoares/agentistics'
const DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/agentop`

const _ESC = '\x1b'
const _R  = `${_ESC}[0m`
const _B  = `${_ESC}[1m`
const _GR = `${_ESC}[92m`
const _WH = `${_ESC}[97m`
const _D  = `${_ESC}[2m`
const _Y  = `${_ESC}[33m`

export async function runUpgrade(): Promise<void> {
  process.stdout.write('Checking for updates...\n')

  let info
  try {
    info = await getVersionInfo()
  } catch {
    console.error('Failed to check for updates. Check your internet connection.')
    process.exit(1)
  }

  if (!info.hasUpdate) {
    console.log(`Already on the latest version (${_GR}${_B}v${info.current}${_R}).`)
    process.exit(0)
  }

  process.stdout.write(
    `\n  ${_D}Current:${_R} ${_WH}v${info.current}${_R}\n` +
    `  ${_D}Latest: ${_R} ${_GR}${_B}v${info.latest}${_R}\n\n`,
  )
  process.stdout.write('Downloading...\n')

  let resp: Response
  try {
    resp = await fetch(DOWNLOAD_URL, {
      headers: { 'User-Agent': `agentistics/${CURRENT_VERSION}` },
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err: any) {
    console.error(`Download failed: ${err.message}`)
    process.exit(1)
  }

  if (!resp.ok) {
    console.error(`Download failed: HTTP ${resp.status}`)
    process.exit(1)
  }

  const currentBin = process.execPath
  const tmpPath = `${currentBin}.new`

  const buf = await resp.arrayBuffer()
  await Bun.write(tmpPath, buf)
  await chmod(tmpPath, 0o755)

  try {
    await rename(tmpPath, currentBin)
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      process.stderr.write(
        `\n${_Y}Permission denied.${_R} The binary was downloaded to:\n` +
        `  ${tmpPath}\n\n` +
        `Run the following to finish the upgrade:\n` +
        `  ${_WH}sudo mv ${tmpPath} ${currentBin}${_R}\n\n`,
      )
    } else {
      await unlink(tmpPath).catch(() => {})
      console.error(`Upgrade failed: ${err.message}`)
    }
    process.exit(1)
  }

  process.stdout.write(`\n${_GR}${_B}Updated to v${info.latest}!${_R} Restart agentop to apply.\n\n`)
}
