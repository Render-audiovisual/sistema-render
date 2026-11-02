# Dedicated Instagram automatic synchronization

## 1. Goal

Keep the connected Instagram accounts' reels, carousels, captions and genuine covers up to date without operational task/publication/objective writes.

## 2. Diagnosis

The existing Hostinger general cron has no useful output and no recent automatically observed completion checkpoints. A previous Instagram-only manual run succeeded. The general runner executes other domains first and must not be manually invoked for this request: those domains can prepare tasks and notifications.

## 3. Dedicated entrypoint

`node backend/scripts/run-instagram-automation.js run`

This worker narrows an already-authorized configuration to `instagram` only. It preserves maintenance, verified database transport, schema checks, the shared scheduler mutex, hourly deduplication and existing account-binding checks. It cannot enable an integration absent from the configured job list, run migrations, start editorial/WhatsApp/AI work or delete tasks. The existing general cron is not removed or changed.

## 4. Refresh policy and limits

Hostinger should invoke the dedicated worker every five minutes. Actual Instagram synchronization is deduplicated per UTC hour, and retries occur on later invocations after errors or a busy guard. Inventory and captions use the existing complete 90-day window. New covers are fetched when discovered; existing cover references are renewed on their six-hour refresh cadence, with a bounded twenty requests/account/run. Unavailable covers remain explicitly unavailable. No fabricated covers/captions or account assignments.

Accounts not connected/authorized in Meta cannot be synchronized automatically. Preserve their existing owner-confirmed records and require explicit account binding rather than guessing identity. Historical data older than the existing feed coverage window is not claimed to be refreshed by this change.

## 5. Validation criteria

The entrypoint must be tested locally, deployed before configuring its cron, and then observed running from Hostinger without a manual production sync. A successful manual execution alone does not validate scheduling. Capture a completion checkpoint, per-account sync results and a later automatic invocation; compare operational fingerprints before/after. Never print configuration secrets.

## 6. Tests

49 worker/runner/policy/CLI tests passed. Eight PostgreSQL integration tests passed on a newly generated local fixture, including two scheduled syncs that update captions and covers and discover a carousel; a repeat in the same hour skips work. Operational tasks, publications and monthly objectives match their original fixture fingerprints.

## 7. Rollout

Prepared on `codex/instagram-automatic-sync`. No migrations or environment-variable changes required. The dedicated Hostinger job must use its Node.js form's absolute environment and current-version prefix, not embed credentials in a command. Verify actual automatic receipts before declaring this activated.
