const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error('Usage: node scripts/run-test-env.js <command> [args]');
  process.exit(1);
}

const developmentMongoUri = process.env.MONGODB_URI;
const mongoUri = new URL(developmentMongoUri);
const developmentMongoDatabase = mongoUri.pathname.replace(/^\//, '');

if (
  process.env.POSTGRES_DB === 'kobomarket_test' ||
  developmentMongoDatabase === 'kobomarket_test'
) {
  console.error('Expected development database configuration in .env');
  process.exit(1);
}

mongoUri.pathname = '/kobomarket_test';

const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  POSTGRES_DB: 'kobomarket_test',
  MONGODB_URI: mongoUri.toString(),
  REDIS_DB: '15'
};

const result = spawnSync(command, args, {
  env: testEnv,
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
