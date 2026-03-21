module.exports = {
  apps: [{
    name: "titanex-agent",
    script: "index.js",
    cwd: "/root/TitanexAI",
    env_file: "/root/TitanexAI/.env",
    env: {
      NODE_ENV: "production"
    }
  }]
}
