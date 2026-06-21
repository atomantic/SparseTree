// =============================================================================
// Port Configuration - All ports defined here as single source of truth
// =============================================================================
const PORTS = {
  API: 6374,    // Express API server
  UI: 6373,     // Vite dev server (client)
  CDP: 9920     // Chrome DevTools Protocol port for browser automation
};

module.exports = {
  PORTS, // Export for other configs to reference

  apps: [
    {
      name: 'sparsetree-server',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      cwd: `${__dirname}/server`,
      interpreter: 'node',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: PORTS.API,
        HOST: '0.0.0.0',
        CDP_PORT: PORTS.CDP
      },
      watch: false
    },
    {
      name: 'sparsetree-ui',
      // vite is hoisted to the repo-root node_modules in this npm workspace, so
      // reference the root bin via an absolute path (the client-local .bin/vite
      // may not exist). interpreter: 'node' so pm2 execs the bin instead of
      // trying to import() it as an ESM module.
      script: `${__dirname}/node_modules/.bin/vite`,
      cwd: `${__dirname}/client`,
      interpreter: 'node',
      args: `--host 0.0.0.0 --port ${PORTS.UI}`,
      env: {
        NODE_ENV: 'development',
        VITE_PORT: PORTS.UI
      },
      watch: false
    },
    {
      name: 'sparsetree-browser',
      script: '.browser/start.sh',
      cwd: __dirname,
      interpreter: 'bash',
      autorestart: false,
      env: {
        CDP_PORT: PORTS.CDP,
        UI_PORT: PORTS.UI,
        // CDP ports of externally-managed browsers to reuse (e.g. PortOS on
        // 5556). When one is up, start.sh skips launching our own Chrome.
        SHARED_CDP_PORTS: '5556'
      }
    }
  ]
};
