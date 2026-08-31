# Controller protocol

The controller emits one JSON object on stdout for every command. Diagnostic text belongs on stderr. Terminal states are `completed`, `failed`, `cancelled`, and `timed_out`.

## Commands

- `doctor`: verify Node, Pi, Pi version, OAuth credential presence, and requested provider models.
- `start`: persist a request, launch a detached supervisor, and return `job_id` immediately.
- `run`: start, wait, and return the terminal receipt.
- `status JOB_ID`: return the latest persisted state.
- `wait JOB_ID`: wait until terminal or until the client-side wait timeout expires.
- `steer JOB_ID --message TEXT`: deliver a steering message before Pi's next model call.
- `follow-up JOB_ID --message TEXT`: queue a message for after the current Pi turn.
- `cancel JOB_ID`: request Pi abort and confirm controller acceptance.
- `resume --session-file PATH`: start a new job using an existing Pi session file.
- `result JOB_ID`: return the terminal receipt and final text.

## Persisted job files

Each job directory contains:

- `request.json`: sanitized immutable launch request; no credentials.
- `state.json`: atomic current-state snapshot.
- `events.jsonl`: raw Pi RPC events and controller lifecycle events.
- `stderr.log`: bounded diagnostic stream from Pi.
- `receipt.json`: terminal structured result.
- `result.md`: final assistant text.
- `control.sock`: Unix socket present only while the supervisor accepts control commands.

## Defaults

- Provider: `openai-codex`
- Model: `gpt-5.6-luna`
- Thinking: `high`
- Reviewer/explorer tools: `read,grep,find,ls`
- Worker tools: `read,grep,find,ls,bash,edit,write`
- Run timeout: 3600 seconds

Credential-like environment variables are removed before Pi starts. Repeat `--allow-env NAME` to pass a required variable deliberately. Pi reads its OAuth credentials from its own agent directory under the user's home.
