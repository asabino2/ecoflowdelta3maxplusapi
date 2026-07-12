FROM node:22-alpine

WORKDIR /app

COPY ecoflowapi.js ./

ENV PORT=18000

EXPOSE 18000

CMD ["node", "ecoflowapi.js"]
