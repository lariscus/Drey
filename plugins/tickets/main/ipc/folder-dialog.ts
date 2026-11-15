import { BrowserWindow, dialog } from 'electron';

/**
 * The system folder picker, opened by Drey's own process (req-304). The board
 * itself runs in Drey Service, a process without a window: a picker asked of
 * the engine always answered "cancelled", which is why Settings → Projects'
 * *Add folder* did nothing. Resolves the chosen folder, or null when cancelled.
 */
export async function pickFolderDialog(title: string, defaultPath?: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const options = {
    title,
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    ...(defaultPath !== undefined && defaultPath !== '' ? { defaultPath } : {}),
  };
  const outcome = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return outcome.canceled ? null : (outcome.filePaths[0] ?? null);
}
