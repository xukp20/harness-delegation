import fs from 'node:fs';
import path from 'node:path';
import { fail, envelope, failure, terminal } from './common.mjs';
import * as jobs from './jobs.mjs';
import { doctor } from './adapters/index.mjs';
import { present } from './presentation.mjs';
export function parseArgs(argv) {
  const positional = []; const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const key = argv[i].slice(2).replaceAll('-', '_');
    if (['help', 'json', 'result', 'detail'].includes(key)) { options[key] = true; continue; }
    if (i + 1 === argv.length || argv[i + 1].startsWith('--')) throw fail('INVALID_REQUEST', `Missing value for --${key}`);
    const value = argv[++i];
    if (key === 'allow_env') (options.allow_env ||= []).push(value); else options[key] = value;
  }
  return { positional, options };
}
export function requestOptions(options) {
  if (options.request_file) return JSON.parse(fs.readFileSync(options.request_file, 'utf8'));
  const request = { harness: options.harness || 'pi', cwd: path.resolve(options.cwd || process.cwd()), task: options.task_file ? fs.readFileSync(options.task_file, 'utf8') : options.task, role: options.role || 'reviewer' };
  if (options.request_key) request.request_key = options.request_key;
  if (options.timeout_seconds) request.timeout_seconds = Number(options.timeout_seconds);
  for (const key of ['write_scope', 'no_touch_scope', 'acceptance']) if (options[key]) request[key] = JSON.parse(options[key]);
  request.harness_options = {};
  for (const key of ['provider', 'model', 'thinking']) if (options[key]) request.harness_options[key] = options[key];
  if (options.tools !== undefined) request.harness_options.tools = options.tools ? options.tools.split(',') : [];
  return request;
}
export async function execute(argv) {
  const options = parseArgs(argv.slice(1)).options;
  const value = await executeRaw(argv);
  return options.help ? value : present(argv[0], value, options);
}
async function executeRaw(argv) {
  const [command, ...rest] = argv; const { positional, options } = parseArgs(rest); const id = positional[0];
  if (!command || options.help) return { usage: 'harness-delegate <harnesses|doctor|start|run|list|status|get|read|wait|send|steer|follow-up|cancel|resume|result|mcp>', protocol: 'docs/protocol.md' };
  if (command === 'mcp') { const { serve } = await import('./mcp.mjs'); await serve(); return undefined; }
  if (command === 'harnesses') return jobs.harnessList();
  if (command === 'doctor') return options.harness ? doctor(options.harness) : jobs.harnessList();
  if (command === 'list') return jobs.list({ cwd: options.cwd, limit: options.limit ? Number(options.limit) : undefined });
  if (command === 'start' || command === 'run') {
    const started = await jobs.start(requestOptions(options));
    if (command === 'start') return started;
    while (!terminal((await jobs.get(started.job_id)).status)) await jobs.wait(started.job_id);
    return jobs.get(started.job_id, { result: true });
  }
  if (!id) throw fail('INVALID_REQUEST', `${command} requires JOB_ID`);
  if (['get', 'status', 'result'].includes(command)) return jobs.get(id, { result: command === 'result' || options.result });
  if (command === 'read') return jobs.read(id, { after: options.after ? Number(options.after) : undefined, limit: options.limit ? Number(options.limit) : undefined });
  if (command === 'wait') return jobs.wait(id, { include_events: options.detail === true, after: options.after !== undefined ? Number(options.after) : undefined, timeout_seconds: options.timeout_seconds !== undefined ? Number(options.timeout_seconds) : undefined });
  if (command === 'cancel') return jobs.control(id, 'cancel', undefined, options.request_key);
  if (['send', 'steer', 'follow-up'].includes(command)) return jobs.control(id, command === 'send' ? options.mode?.replace('-', '_') : command.replace('-', '_'), options.message_file ? fs.readFileSync(options.message_file, 'utf8') : options.message, options.request_key);
  if (command === 'resume') return jobs.resume(id, options.request_file ? JSON.parse(fs.readFileSync(options.request_file, 'utf8')) : { task: options.task_file ? fs.readFileSync(options.task_file, 'utf8') : options.task, ...(options.request_key ? { request_key: options.request_key } : {}) });
  throw fail('INVALID_REQUEST', `Unknown command: ${command}`);
}
export async function main(argv = process.argv.slice(2)) {
  try { const data = await execute(argv); if (data !== undefined) process.stdout.write(JSON.stringify(envelope(data)) + '\n'); }
  catch (e) { process.stdout.write(JSON.stringify(failure(e)) + '\n'); process.exitCode = 1; }
}
