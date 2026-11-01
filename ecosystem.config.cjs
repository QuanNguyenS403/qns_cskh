module.exports = {
  apps: [
    {
      name: 'quannguyens-ai-cskh',
      script: 'src/server.js',
      node_args: '--experimental-sqlite',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3002,
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
      kill_timeout: 5000,
      wait_ready: false,
    },
    // quannguyens-playwright-worker da duoc go bo de chuyen sang van hanh Cloud 24/7 qua Botcake + Render (khong ton RAM laptop va khong can mo may)
    // Neu can bat lai Playwright cuc bo: bo comment khoi ben duoi
    /*
    {
      name: 'quannguyens-playwright-worker',
      script: 'scripts/playwright_worker.js',
      node_args: '--experimental-sqlite',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      exp_backoff_restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        PLAYWRIGHT_HEADLESS: 'true',
        PLAYWRIGHT_AUTO_REPLY: 'true',
      },
      error_file: 'logs/pm2-playwright-error.log',
      out_file: 'logs/pm2-playwright-out.log',
      merge_logs: true,
      time: true,
      kill_timeout: 10000,
    },
    */
  ],
}
