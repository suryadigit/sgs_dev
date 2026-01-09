import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

const shouldLogQueries = process.env.PRISMA_LOG === 'true' || process.env.NODE_ENV === 'development';
const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: shouldLogQueries ? ['query', 'info', 'warn', 'error'] : (process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']),
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (shouldLogQueries) {
  prisma.$on('query', (e) => {
    console.log(`Prisma Query (${e.duration}ms): ${e.query}`);
  });
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 3;

const connectWithRetry = async () => {
  while (connectionRetries < MAX_RETRIES) {
    try {
      await prisma.$connect();
      isConnected = true;
      connectionRetries = 0;
      console.log('✅ Prisma connected to database');
      return;
    } catch (err) {
      connectionRetries++;
      console.error(`❌ Prisma connection attempt ${connectionRetries}/${MAX_RETRIES} failed:`, err.message);
      if (connectionRetries < MAX_RETRIES) {
        console.log(`⏳ Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  console.error('❌ Failed to connect after max retries');
};

connectWithRetry();

const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000; // 4 minutes

setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.warn('⚠️ Keep-alive ping failed, reconnecting...');
    isConnected = false;
    connectWithRetry();
  }
}, KEEP_ALIVE_INTERVAL);

export const ensureConnection = async () => {
  if (!isConnected) {
    await connectWithRetry();
  }
};

export default prisma;
