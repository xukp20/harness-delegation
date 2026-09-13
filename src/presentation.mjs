// Public responses are projections; persisted evidence and lifecycle state stay intact.
function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function stateView(value) {
  const out = pick(value, ['job_id', 'status', 'harness', 'execution_may_continue', 'final_text']);
  if (value.error) out.error = pick(value.error, ['code', 'message']);
  if (value.cleanup) out.cleanup = pick(value.cleanup, ['stopped', 'error']);
  if (value.text_truncated || value.final_text_truncated) out.final_text_truncated = true;
  if (Object.values(value.log_truncated || {}).some(Boolean)) out.log_truncated = true;
  return out;
}
export function compactEvents(events) {
  const out = []; let adjacent = false;
  for (const event of events) {
    const text = event.type === 'text.delta' && typeof event.data?.text === 'string' && !event.data.truncated;
    if (text && adjacent) {
      out.at(-1).data.text += event.data.text;
      out.at(-1).seq = event.seq;
    } else if (text) {
      out.push({ seq: event.seq, type: 'text', data: { text: event.data.text } });
    } else if (!['job.started', 'tools.verified', 'text.boundary'].includes(event.type)) {
      const data = { ...event.data }; delete data.native_id;
      out.push({ seq: event.seq, type: event.type, data });
    }
    adjacent = text;
  }
  return out;
}
export function present(operation, value, { detail = false } = {}) {
  if (detail || value === undefined) return value;
  if (['harness_list', 'harnesses', 'doctor'].includes(operation)) {
    const view = item => pick(item, ['harness', 'available', 'version', 'error', 'authentication', 'capabilities']);
    return Array.isArray(value) ? value.map(view) : view(value);
  }
  if (['task_list', 'list'].includes(operation)) return value.map(item => ({ ...stateView(item), ...pick(item, ['cwd', 'role']) }));
  if (['task_get', 'get', 'status', 'result', 'run'].includes(operation)) return stateView(value);
  if (['task_start', 'task_resume', 'start', 'resume'].includes(operation)) return pick(value, ['job_id', 'status', 'reused']);
  if (['task_wait', 'wait'].includes(operation)) return { state: stateView(value.state), ...pick(value, ['terminal', 'timed_out', 'next_cursor', 'has_more']) };
  if (['task_read', 'read'].includes(operation)) {
    const out = { ...pick(value, ['job_id', 'status', 'terminal', 'next_cursor', 'has_more']), events: compactEvents(value.events) };
    if (Object.values(value.truncated || {}).some(Boolean)) out.truncated = true;
    return out;
  }
  return value;
}
