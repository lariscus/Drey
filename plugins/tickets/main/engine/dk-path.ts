import * as path from 'node:path';

/**
 * Which `dk` Drey runs (req-277). The installer ships the pinned dricket
 * release as `<resources>/dk/dk.exe`; the engine, Drey Service, the runs and
 * the chain all read the one `dk.path` key of the engine's config, so Drey
 * writes the RESOLVED path there (`service-lifecycle.ts` syncs the plugin
 * config through {@link withEffectiveDkPath}) and nothing else needs to know
 * where the binary lives. The engine package never sees Electron.
 *
 * The rule, first match wins:
 *  1. a configured `dk.path` (Settings, or the config file) — the owner's choice;
 *  2. packaged: the bundled `<resources>/dk/dk.exe`, when the file exists;
 *  3. empty — the engine runs `dk` from PATH (dev, or a damaged install).
 */
export interface DkRuntime {
  /** `app.isPackaged`. */
  readonly packaged: boolean;
  /** `process.resourcesPath`. */
  readonly resourcesPath: string;
  readonly platform: NodeJS.Platform;
  readonly exists: (file: string) => boolean;
}

/** Where the installer puts `dk` inside the resources folder. */
export function bundledDkPath(resourcesPath: string, platform: NodeJS.Platform): string {
  return path.join(resourcesPath, 'dk', platform === 'win32' ? 'dk.exe' : 'dk');
}

/** The `dk.path` the engine is given: the configured value, else the bundled binary, else '' (PATH). */
export function resolveDkPath(configured: string, runtime: DkRuntime): string {
  const own = configured.trim();
  if (own !== '') {
    return own;
  }
  if (!runtime.packaged || runtime.resourcesPath === '') {
    return '';
  }
  const bundled = bundledDkPath(runtime.resourcesPath, runtime.platform);
  return runtime.exists(bundled) ? bundled : '';
}

interface ConfigReader {
  get<T>(key: string): Promise<T | undefined>;
}

/**
 * The plugin config as the engine should see it: `dk.path` is the resolved
 * path (also when the config holds no value, so a cleared field takes the
 * bundled binary again); every other key is read through unchanged.
 */
export function withEffectiveDkPath(config: ConfigReader, runtime: DkRuntime): ConfigReader {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      if (key === 'dk.path') {
        const configured = await config.get<unknown>(key);
        return resolveDkPath(typeof configured === 'string' ? configured : '', runtime) as T;
      }
      return config.get<T>(key);
    },
  };
}
