FROM node:24-alpine

RUN npm install --global @pg-boss/dashboard@1.13.1

USER node
ENV PORT=3000
EXPOSE 3000
CMD ["pg-boss-dashboard"]
