# Integrations Handbook

This document is the single guide for external integrations and publishing workflows.

## 1. Feishu Alerts

Add Feishu group mappings in `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "groups": {
        "ops-group": "oc_xxxxxxxxxxxxxx",
        "management": "oc_yyyyyyyyyyyyyy"
      }
    }
  }
}
```

Typical usage:

- `["feishu:ops-group"]`: send operational alerts
- `["feishu:management"]`: send summaries or weekly reports
- `[]`: record only, do not send

Example cron job:

```json
{
  "k8s-morning-check": {
    "schedule": "0 9 * * *",
    "deliveryQueue": ["feishu:ops-group"]
  }
}
```

Recommended alert categories:

- daily cluster health summary
- urgent etcd or control-plane alerts
- certificate expiry reminders
- restart anomaly reports

## 2. GitHub Publish and Sync

First publish:

```bash
./push-to-github.sh
```

Daily sync:

```bash
./sync-to-github.sh
```

Manual flow:

```bash
git status
git add -A
git commit -m "docs: sync project updates"
git push
```

## 3. Minimal Maintenance Rules

- Keep `README.md` and `README_CN.md` as entry documents only
- Put long-form docs under `docs/`
- Keep examples under `examples/`
- Move milestone notes and practice logs into `docs/archive/`

## Related Docs

- [getting-started.md](getting-started.md)
- [operations.md](operations.md)
- [../../DOCS.md](../../DOCS.md)
