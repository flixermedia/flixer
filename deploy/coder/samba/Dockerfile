FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends samba \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 coder \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin coder

COPY smb.conf /etc/samba/smb.conf
COPY entrypoint.sh /usr/local/bin/samba-entrypoint
RUN chmod 0755 /usr/local/bin/samba-entrypoint

EXPOSE 445
ENTRYPOINT ["/usr/local/bin/samba-entrypoint"]
