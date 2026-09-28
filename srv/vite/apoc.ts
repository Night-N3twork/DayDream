
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { build, type Plugin } from 'vite'

const REPO_URL = 'https://github.com/Night-N3twork/Apocalypse.git'
const VIRTUAL_RUNTIME_ID = 'virtual:apocalypse-runtime'
const RESOLVED_VIRTUAL_RUNTIME_ID = `\0${VIRTUAL_RUNTIME_ID}`
const RUNTIME_GLOBAL = '__apocalypseRemoteRuntime'

export type RemoteApocalypseConfig = {
  seed: string
  repository?: string
  revision?: string
  features?: Record<string, boolean>
  forbiddenStrings?: string[]
  [key: string]: unknown
}

function log(msg: string) {
  console.log(`[apocalypse-remote] ${redactUrlUserinfo(msg)}`)
}

function warn(msg: string) {
  console.warn(`[apocalypse-remote] WARN: ${redactUrlUserinfo(msg)}`)
}

function redactUrlUserinfo(message: string): string {
  return message.replace(/([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi, '$1***@')
}

function tryRun(command: string, args: string[], cwd: string): boolean {
  try {
    execFileSync(command, args, { cwd, stdio: 'pipe', timeout: 120_000 })
    return true
  } catch (e: any) {
    warn(`Command failed: ${command} ${args.join(' ')}\n${e?.stderr?.toString?.() ?? e}`)
    return false
  }
}

type RemoteBuild = {
  pluginEntrypoint: string
  runtimeSource: string
}

type InMemoryChunk = {
  type: string
  code?: string
}

async function cloneAndBuild(workspace: string, repository = REPO_URL, revision?: string): Promise<RemoteBuild | null> {
  log(`Cloning ${repository} → ${workspace}`)

  if (!tryRun('git', ['clone', '--depth=1', repository, workspace], tmpdir())) {
    warn('git clone failed — skipping remote apocalypse plugin.')
    return null
  }

  if (revision && !tryRun('git', ['fetch', '--depth=1', 'origin', revision], workspace)) {
    warn('git fetch failed — skipping remote apocalypse plugin.')
    return null
  }
  if (revision && !tryRun('git', ['checkout', '--detach', 'FETCH_HEAD'], workspace)) {
    warn('git checkout failed — skipping remote apocalypse plugin.')
    return null
  }

  const hasBun = spawnSync('bun', ['--version'], { stdio: 'pipe' }).status === 0
  const hasPnpm = spawnSync('pnpm', ['--version'], { stdio: 'pipe' }).status === 0

  const [packageManager, installArgs] = hasBun
    ? ['bun', ['install', '--frozen-lockfile', '--ignore-scripts']]
    : hasPnpm
      ? ['pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']]
      : ['npm', ['install', '--ignore-scripts', '--prefer-offline']]

  log(`Installing deps: ${packageManager} ${installArgs.join(' ')}`)
  if (!tryRun(packageManager, installArgs, workspace)) {
    warn('Dependency install failed — skipping remote apocalypse plugin.')
    return null
  }

  try {
    await build({
      root: workspace,
      configFile: false,
      logLevel: 'silent',
      build: {
        lib: {
          entry: join(workspace, 'src', 'vite-plugin.ts'),
          formats: ['es'],
          fileName: 'apocalypse-plugin',
        },
        outDir: join(workspace, '.apocalypse-build'),
        emptyOutDir: true,
        rollupOptions: { external: ['vite', 'ts-morph'] },
      },
    })
  } catch (error) {
    warn(`Vite library build failed: ${error}`)
    return null
  }

  try {
    const runtimeBuild = await build({
      root: workspace,
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        lib: {
          entry: join(workspace, 'src', 'bypass', 'scramjetSurfaceGuards.ts'),
          formats: ['iife'],
          name: RUNTIME_GLOBAL,
          fileName: 'apocalypse-runtime',
        },
      },
    })
    const runtimeOutput = (Array.isArray(runtimeBuild) ? runtimeBuild[0] : runtimeBuild) as
      | { output?: InMemoryChunk[] }
      | undefined
    const runtimeChunk = runtimeOutput?.output?.find(output => output.type === 'chunk')

    if (!runtimeChunk?.code) {
      warn('Runtime IIFE build produced no JavaScript output — skipping remote apocalypse plugin.')
      return null
    }

    return {
      pluginEntrypoint: pathToFileURL(join(workspace, '.apocalypse-build', 'apocalypse-plugin.js')).href,
      runtimeSource: runtimeChunk.code,
    }
  } catch (error) {
    warn(`Runtime IIFE build failed: ${error}`)
    return null
  }
}

/**
 * Create the remote Apocalypse Vite plugin.
 * Clones + builds at buildStart, then delegates all hooks to the remote plugin.
 */
export function apocalypseRemotePlugin(cfg: RemoteApocalypseConfig): Plugin {
  let remotePlugin: Plugin | null = null
  let runtimeSource: string | undefined
  let attempted = false
  let workspace: string | undefined

  function cleanup(): void {
    try {
      if (workspace) rmSync(workspace, { recursive: true, force: true })
    } finally {
      workspace = undefined
      runtimeSource = undefined
    }
  }

  async function loadRemote(): Promise<void> {
    if (attempted) return
    attempted = true
    cleanup()
    workspace = mkdtempSync(join(tmpdir(), 'apocalypse-remote-'))
    try {
      const remoteBuild = await cloneAndBuild(workspace, cfg.repository, cfg.revision)
      if (!remoteBuild) {
        cleanup()
        return
      }

      const mod: any = await import(remoteBuild.pluginEntrypoint)
      const factory = mod?.apocalypsePlugin

      if (typeof factory !== 'function') {
        warn('Remote module does not export a plugin factory — skipping.')
        cleanup()
        return
      }

      remotePlugin = factory(cfg)
      runtimeSource = remoteBuild.runtimeSource
      log('Remote plugin loaded and active.')
    } catch (err) {
      warn(`Unexpected error loading remote plugin: ${err}`)
      cleanup()
    }
  }

  return {
    name: 'apocalypse-remote',
    enforce: 'post',

    async buildStart(...args: any[]) {
      await loadRemote()
      if (remotePlugin?.buildStart) {
        return (remotePlugin.buildStart as Function).call(this, ...args)
      }
    },

    resolveId(...args: any[]) {
      if (args[0] === VIRTUAL_RUNTIME_ID && runtimeSource) return RESOLVED_VIRTUAL_RUNTIME_ID
      if (!remotePlugin?.resolveId) return
      return (remotePlugin.resolveId as Function).call(this, ...args)
    },

    load(...args: any[]) {
      if (args[0] === RESOLVED_VIRTUAL_RUNTIME_ID && runtimeSource) {
        return `${runtimeSource}\nexport const installScramjetSurfaceGuards = ${RUNTIME_GLOBAL}.installScramjetSurfaceGuards;`
      }
      if (!remotePlugin?.load) return
      return (remotePlugin.load as Function).call(this, ...args)
    },

    transform(...args: any[]) {
      if (!remotePlugin?.transform) return
      return (remotePlugin.transform as Function).call(this, ...args)
    },

    generateBundle(...args: any[]) {
      if (!remotePlugin?.generateBundle) return
      return (remotePlugin.generateBundle as Function).call(this, ...args)
    },

    async buildEnd(...args: any[]) {
      try {
        if (remotePlugin?.buildEnd) {
          return await (remotePlugin.buildEnd as Function).call(this, ...args)
        }
      } finally {
        cleanup()
      }
    },
  }
}
