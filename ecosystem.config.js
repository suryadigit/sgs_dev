module.exports = {
  apps: [{
    name: 'sgs-api',
    script: './src/index.js',
    cwd: '/home/sikunimed/sgs/sgs_dev',
    env_production: {
      NODE_ENV: 'production',
      USE_REDIS: 'false',
      REDIS_URL: '',
      PORT: '4000'
    }
  }]
};
