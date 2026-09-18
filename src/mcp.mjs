import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as jobs from './jobs.mjs';
import { envelope, failure, fail } from './common.mjs';
import { present } from './presentation.mjs';
const string = { type: 'string' };
const tool = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const tools = [
  tool('harness_list', 'Inspect Pi/Grok binaries and declared capabilities without a model call.'),
  tool('task_start', 'Start a bounded external harness job. Reuse request_key when retrying. Worker requires authorized write_scope.', { harness: { enum: ['pi', 'grok', 'dsh'] }, cwd: string, task: string, role: { enum: ['reviewer', 'explorer', 'worker'] }, request_key: string, write_scope: { type: 'array', items: string }, no_touch_scope: { type: 'array', items: string }, acceptance: { type: 'array', items: string }, timeout_seconds: { type: 'number' }, harness_options: { type: 'object', properties: { model: string, provider: string, thinking: string, tools: { type: 'array', items: string } }, additionalProperties: false } }, ['harness', 'cwd', 'task', 'request_key']),
  tool('task_list', 'List persisted bridge jobs.', { cwd: string, limit: { type: 'integer' } }),
  tool('task_get', 'Get state and optionally terminal result; completed is not independent acceptance.', { job_id: string, result: { type: 'boolean' } }, ['job_id']),
  tool('task_read', 'Read progress with adjacent text merged. Advance next_cursor even on empty pages; has_more indicates persisted backlog.', { job_id: string, after: { type: 'integer' }, limit: { type: 'integer' } }, ['job_id']),
  tool('task_wait', 'Wait at most 45 seconds for terminal or new events; returns status only by default. Read progress separately. Timeout never cancels work.', { job_id: string, after: { type: 'integer' }, timeout_seconds: { type: 'number', maximum: 45 } }, ['job_id']),
  tool('task_send', 'Pi steer or follow_up. Grok does not support these controls.', { job_id: string, mode: { enum: ['steer', 'follow_up'] }, message: string, request_key: string }, ['job_id', 'mode', 'message', 'request_key']),
  tool('task_cancel', 'Request cancellation; read receipt to confirm termination.', { job_id: string, request_key: string }, ['job_id', 'request_key']),
  tool('task_resume', 'New job continuing a stopped session in its original workspace.', { job_id: string, task: string, request_key: string }, ['job_id', 'task', 'request_key']),
];
for (const spec of tools) if (['harness_list', 'task_list', 'task_get', 'task_read', 'task_wait'].includes(spec.name)) spec.inputSchema.properties.detail = { type: 'boolean', description: 'Include full diagnostic state and raw events; default is compact.' };
function validateValue(value, schema, label) {
  if (schema.enum && !schema.enum.includes(value)) throw fail('INVALID_REQUEST', `Invalid ${label}`);
  if (schema.type === 'string' && typeof value !== 'string') throw fail('INVALID_REQUEST', `${label} must be a string`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw fail('INVALID_REQUEST', `${label} must be boolean`);
  if (['integer', 'number'].includes(schema.type) && (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)))) throw fail('INVALID_REQUEST', `${label} must be numeric`);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > 100) throw fail('INVALID_REQUEST', `${label} must be a bounded array`);
    value.forEach(item => validateValue(item, schema.items, label));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_REQUEST', `${label} must be an object`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw fail('INVALID_REQUEST', `Unknown field: ${key}`);
      validateValue(value[key], schema.properties[key], key);
    }
    for (const key of schema.required || []) if (value[key] === undefined) throw fail('INVALID_REQUEST', `Missing ${key}`);
  }
}
export async function dispatch(name, args = {}) {
  const spec = tools.find(t => t.name === name); if (!spec) throw fail('UNKNOWN_TOOL', name);
  validateValue(args, spec.inputSchema, 'arguments');
  return present(name, await dispatchRaw(name, args), args);
}
async function dispatchRaw(name, args) {
  const { job_id, ...options } = args;
  if (name === 'harness_list') return jobs.harnessList();
  if (name === 'task_start') return jobs.start(args);
  if (name === 'task_list') return jobs.list(args);
  if (name === 'task_get') return jobs.get(job_id, options);
  if (name === 'task_read') return jobs.read(job_id, options);
  if (name === 'task_wait') return jobs.wait(job_id, { ...options, include_events: options.detail === true });
  if (name === 'task_send') return jobs.control(job_id, args.mode, args.message, args.request_key);
  if (name === 'task_cancel') return jobs.control(job_id, 'cancel', undefined, args.request_key);
  if (name === 'task_resume') return jobs.resume(job_id, options);
}
export async function serve() {
  const server = new Server({ name: 'harness-delegation', version: '0.2.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    let result; try { result = envelope(await dispatch(request.params.name, request.params.arguments)); } catch (e) { result = failure(e); }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok };
  });
  await server.connect(new StdioServerTransport());
}
