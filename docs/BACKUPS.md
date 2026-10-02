# Auto-Media backup and restore

The optional `backup` Compose profile creates:
- PostgreSQL dumps under `./backups/automedia-<timestamp>.sql.gz`
- local media archives under `./backups/automedia-files-<timestamp>.tgz`
- n8n state archives under `./backups/automedia-n8n-<timestamp>.tgz`
- SHA-256 manifests for generated backup files

Enable it with:

    docker compose --profile backup up -d automedia-backup

For production, set `BACKUP_ENCRYPTION_PASSWORD` to a strong secret. Without it, database/media/n8n backup files remain unencrypted on the backup volume.

## Restore

Stop the application workers before restoring:

    docker compose stop automedia n8n

Restore PostgreSQL from a dump:

    gunzip -c ./backups/automedia-<timestamp>.sql.gz | docker exec -i automedia-postgres psql -U automedia -d automedia

Restore local media:

    docker run --rm -v "$PWD/media:/restore" -v "$PWD/backups:/backups" alpine sh -c 'tar -xzf /backups/automedia-files-<timestamp>.tgz -C /restore'

Restore n8n state only when the n8n container is stopped and the backup matches the deployed n8n data layout:

    docker run --rm -v automedia-n8n:/restore -v "$PWD/backups:/backups" alpine sh -c 'rm -rf /restore/* /restore/.[!.]* /restore/..?* 2>/dev/null || true; tar -xzf /backups/automedia-n8n-<timestamp>.tgz -C /restore'

After restoring, start the services:

    docker compose up -d automedia
    docker compose --profile n8n up -d n8n

Verify the application health endpoint, Studio database health, n8n connection, and at least one publishing account before re-enabling automated schedules.

## S3/MinIO

When `STORAGE_MODE=s3`, uploaded/generated media lives in object storage instead of `./media`. The backup profile still preserves PostgreSQL and n8n state; object-storage backup/versioning should be handled by the S3/MinIO provider or a separate bucket replication policy.
