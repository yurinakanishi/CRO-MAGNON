import { readFile } from 'node:fs/promises';
import path from 'node:path';
const verification = JSON.parse(await readFile('assets/cloudflare/account-verification.json', 'utf8'));
const accountId = verification.accountId;
if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Invalid verified account ID');
const config = await readFile(path.join(process.env.APPDATA, 'xdg.config/.wrangler/config/default.toml'), 'utf8');
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Wrangler login is required');
for (const endpoint of ['workers/account-settings', 'subscriptions']) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000)
  });
  const body = await response.json();
  console.log(JSON.stringify({ accountId, endpoint, status: response.status, success: body.success,
    result: endpoint === 'subscriptions' ? body.result?.map(item => ({ state: item.state, plan: item.rate_plan?.id })) : body.result,
    errors: body.errors?.map(error => ({ code: error.code, message: error.message })) }));
}
