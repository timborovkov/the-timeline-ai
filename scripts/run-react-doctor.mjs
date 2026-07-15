import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const outputDir = mkdtempSync(join(tmpdir(), 'react-doctor-'));

function exitWith(message, code = 1) {
  rmSync(outputDir, { force: true, recursive: true });
  console.error(message);
  process.exit(code);
}

try {
  const result = spawnSync('react-doctor', ['--json', '--output-dir', outputDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) exitWith(`[react-doctor] Failed to run analyzer: ${result.error.message}`);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    exitWith(`[react-doctor] Analyzer exited with status ${String(result.status)}.`);
  }

  const jsonStart = result.stdout.indexOf('{');
  if (jsonStart === -1) exitWith('[react-doctor] Analyzer did not emit JSON output.');

  const report = JSON.parse(result.stdout.slice(jsonStart));
  const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  const total = Number(report.summary?.totalDiagnosticCount ?? diagnostics.length);
  if (!report.ok || total > 0) {
    process.stdout.write(result.stdout);
    exitWith(`[react-doctor] Found ${String(total)} diagnostics.`);
  }

  const response = await fetch('https://www.react.doctor/api/score', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    body: gzipSync(Buffer.from(JSON.stringify({ diagnostics }))),
  });
  if (!response.ok) {
    exitWith(`[react-doctor] Score API failed with HTTP ${String(response.status)}.`);
  }

  const scored = await response.json();
  const score = Number(scored.score);
  if (!Number.isFinite(score)) exitWith('[react-doctor] Score API did not return a numeric score.');
  console.log(`React Doctor score: ${String(score)} (${String(scored.label ?? 'unlabeled')})`);
  if (score < 100) exitWith(`[react-doctor] Expected score 100, received ${String(score)}.`);
  console.log('No issues found!');
} catch (error) {
  exitWith(`[react-doctor] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  rmSync(outputDir, { force: true, recursive: true });
}
