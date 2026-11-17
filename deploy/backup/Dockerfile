# The backup service: a small Alpine box with the PostgreSQL 17 tools and rclone. It runs the nightly backup and the weekly restore check
# on a schedule (busybox crond) and nothing else. Build context: the repository root (see deploy/docker-compose.yml).
FROM alpine:3.21
RUN apk add --no-cache bash postgresql17-client rclone tar gzip tzdata coreutils findutils ca-certificates
COPY deploy/backup/lib.sh deploy/backup/backup-now deploy/backup/restore-check deploy/backup/offsite deploy/backup/status deploy/backup/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup-now /usr/local/bin/restore-check /usr/local/bin/offsite /usr/local/bin/status /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["cron"]