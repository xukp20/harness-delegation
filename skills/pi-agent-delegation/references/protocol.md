# Compatibility protocol

The project is now Harness Delegation. See [current protocol](../../../docs/protocol.md) and [migration](../../../docs/migration.md).

The old script returns raw JSON and understands old `pi_*` terminal receipts. New jobs use `job_<uuid>` and the shared lifecycle. Use the original 0.1.0 controller for already-running old supervisors; do not migrate their state while active.
