FROM postgres:17-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /backups \
    && chown postgres:postgres /backups
COPY backup.py /usr/local/bin/planora-backup.py
USER postgres
ENTRYPOINT ["python3", "/usr/local/bin/planora-backup.py"]
