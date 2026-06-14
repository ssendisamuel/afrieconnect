module.exports = {
  apps: [{
    name: 'afrieconnect',
    script: 'server.js',
    cwd: '/home/afriezon/afrieconnect.afriezon.com',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3600
    }
  }]
};
