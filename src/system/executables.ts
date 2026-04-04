import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export async function findExecutable(command: string): Promise<string | null> {
  if (command.includes(path.sep)) {
    return (await isExecutable(command)) ? command : null;
  }

  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter((entry) => entry.length > 0)
      : [''];

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32' &&
        extension.length > 0 &&
        !command.toLowerCase().endsWith(extension.toLowerCase())
          ? path.join(pathEntry, `${command}${extension}`)
          : path.join(pathEntry, command);

      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(
      filePath,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}
