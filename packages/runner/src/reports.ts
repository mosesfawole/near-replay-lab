import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertRunReport, type RunReport } from '../../core/src/index.js';

export async function writeRunReport(path: string, report: RunReport): Promise<void> {
  assertRunReport(report);
  const destination = resolve(path), temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
}

export async function inspectRunReport(path: string): Promise<RunReport> {
  const text = await readFile(resolve(path), 'utf8');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('The report is not valid JSON.'); }
  return assertRunReport(data);
}
