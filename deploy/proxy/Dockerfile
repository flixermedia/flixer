FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN adduser -D -u 1000 appuser && chown -R 1000:1000 /etc/nginx/conf.d
USER 1000

EXPOSE 80
