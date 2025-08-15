import { ApiPromise, WsProvider } from "@polkadot/api";
import BigNumber from "bignumber.js";
import fs from "fs";

const VSDOT_ID = '{"VSToken2":"0"}';
const TOKENS = [
  { token: '{"LPToken":["ASG","9","ASG","10"]}', addr: 'eCSrvaystgdffuJxPVS4SfFvaM26m6tAxwDLPvawBAYbnJd', name: 'lp_vdot_vsdot' },
  { token: '{"BLP":"4"}', addr: 'eCSrvbA5gGNQr7UjcTPxAunuRuuCrQb4NzXaRJbd22jUr4G', name: 'blp_vdot_vsdot' },
]
const POOLS = [
  { pool_id: '4', name: 'pool4', field_name: 'lp_vdot_vsdot', addr: 'eCSrvbA5gGLejANY2YTH6rTd7JxtybT57MyGfGdfqbBPVdZ' },
  { pool_id: '11', name: 'pool11', field_name: 'blp_vdot_vsdot', addr: 'eCSrvbA5gGLejANY2aMUHfaQa3M6rJaDowY8G5UuciHGq1h' },
]
const rpc = "wss://hk.p.bifrost-rpc.liebi.com/ws";
const block = parseInt(process.argv[2]);
const dir = process.argv[3] ? process.argv[3] : "../snapshots/vsdot-holders.json";

async function main() {
  if (Number.isInteger(block) && block > 0) {
    console.log("fetching holders for block " + block);
  } else {
    console.log(
      "please specify a block number after the command (e.g. node index.js 4700000)"
    );
  }

  fs.mkdirSync("data", { recursive: true });

  console.log("connecting to " + rpc);
  const wsProvider = new WsProvider(rpc);
  const api = await ApiPromise.create({ provider: wsProvider });
  const currentBlock = (await api.rpc.chain.getBlock()).block.header.number;
  const blockHash = await api.rpc.chain.getBlockHash(block || currentBlock);
  const apiAt = await api.at(blockHash);
  console.log(
    `connected, head at #${currentBlock}, fetching token holders at #${block || currentBlock
    }...`
  );
  let token_holdings = [];
  await fetchTokenHolders(apiAt, token_holdings);
  await fetchFarming(apiAt, token_holdings);
  let system_account = await removeSystemAccount(token_holdings);
  console.log("writing system-account.json");
  fs.writeFileSync("data/system-account.json", JSON.stringify(system_account, 2, 2));
  // Fill in the statistics in the first item.
  await makeStatistics(apiAt, token_holdings, block || currentBlock);
  console.log(`writing ${dir}`);
  fs.writeFileSync(dir, JSON.stringify(token_holdings, 2, 2));
}
main().catch(console.error).finally(() => process.exit());

async function fetchTokenHolders(apiAt, token_holdings) {
  let new_tokens = TOKENS;
  for (let i = 0; i < TOKENS.length; i++) {
    let token = TOKENS[i];
    let free = BigNumber((await apiAt.query.tokens.accounts(token.addr, JSON.parse(VSDOT_ID))).free);
    let per_share = free.dividedBy(await apiAt.query.tokens.totalIssuance(JSON.parse(token.token)));
    new_tokens[i].per_share = per_share;
  }

  const tokensAccount = await apiAt.query.tokens.accounts.entries();
  const result = tokensAccount.map((item) => {
    const account = item[0].toHuman()[0];
    const token = JSON.stringify(item[0].toHuman()[1]);
    const free = BigNumber(item[1].free).toString();
    const reserved = BigNumber(item[1].reserved).toString();
    const frozen = BigNumber(item[1].frozen).toString();

    if (token === VSDOT_ID) {
      const index = token_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        token_holdings[index].free = free;
        token_holdings[index].reserved = reserved;
        token_holdings[index].frozen = frozen;
        token_holdings[index].total_token = BigNumber(token_holdings[index].total_token).plus(free).toFixed(0);
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        newItem.free = free;
        newItem.reserved = reserved;
        newItem.frozen = frozen;
        newItem.total_token = free;
        token_holdings.push(newItem);
      }
    } else {
      let new_token = new_tokens.find((item) => item.token === token);
      if (new_token) {
        const index = getIndexByAccount(token_holdings, account);
        token_holdings[index][new_token.name] = new_token.per_share.multipliedBy(free).toFixed(0);
        token_holdings[index].total_token = BigNumber(token_holdings[index].total_token).plus(token_holdings[index][new_token.name]).toFixed(0);
      }
    }
    return {
      key: account + '-' + token,
      account,
      token,
      free,
      reserved,
      frozen,
    };
  });
  // console.log("writing all-token-holders.json");
  // fs.writeFileSync("data/all-token-holders.json", JSON.stringify(result, 2, 2));
}

async function fetchFarming(apiAt, token_holdings) {
  let new_pools = POOLS;
  for (let i = 0; i < POOLS.length; i++) {
    let pool = POOLS[i];
    let poolInfo = JSON.parse(JSON.stringify(await apiAt.query.farming.poolInfos(pool.pool_id)));
    let per_share = BigNumber(token_holdings.find((item) => item.account === poolInfo.keeper)[pool.field_name])
      .dividedBy(poolInfo.totalShares);
    new_pools[i].per_share = per_share;
  }

  const farming = await apiAt.query.farming.sharesAndWithdrawnRewards.entries();
  const result = farming.map((item) => {
    let value = JSON.parse(JSON.stringify(item[1].toHuman()));
    const pool_id = item[0].toHuman()[0];
    const account = item[0].toHuman()[1];
    const intValue = parseInt(value.share.replace(/,/g, ''), 10);
    const share = intValue;

    let pool = new_pools.find((item) => item.pool_id === pool_id);
    if (pool) {
      const index = getIndexByAccount(token_holdings, account);
      token_holdings[index][pool.name] = pool.per_share.multipliedBy(share).toFixed(0);
      token_holdings[index].total_token = BigNumber(token_holdings[index].total_token).plus(token_holdings[index][pool.name]).toFixed(0);
    }

    return {
      key: account + '-' + pool_id,
      account,
      pool_id,
      share,
    };
  });
  console.log("writing farming.json");
  fs.writeFileSync("data/farming.json", JSON.stringify(result, 2, 2));
}

async function makeStatistics(apiAt, token_holdings, block) {
  let token_total_issuance = await apiAt.query.tokens.totalIssuance(JSON.parse(VSDOT_ID))
  let total_token = BigNumber(0);
  token_holdings.forEach((item) => {
    if (item.account) total_token = total_token.plus(item.total_token);
  });
  token_holdings.unshift({
    block_height: block,
    token_total_issuance: token_total_issuance.toString(),  // The total number of tokens on chain
    total_token: total_token.toFixed(0), // The total number of tokens in this statistics file
  })
}

function removeSystemAccount(token_holdings) {
  let result = [];
  TOKENS.forEach((token) => {
    const index = token_holdings.findIndex(
      (item) => item.account === token.addr
    );
    if (index !== -1) {
      result.push(token_holdings[index])
      token_holdings.splice(index, 1);
    }
  });
  POOLS.forEach((pool) => {
    const index = token_holdings.findIndex(
      (item) => item.account === pool.addr
    );
    if (index !== -1) {
      result.push(token_holdings[index])
      token_holdings.splice(index, 1);
    }
  });
  return result;
}

function createDefaultData() {
  return {
    account: '',
    free: '0',
    reserved: '0',
    frozen: '0',
    lp_vdot_vsdot: '0',
    blp_vdot_vsdot: '0',
    pool4: '0',
    pool11: '0',
    total_token: '0',
  };
}

export function getIndexByAccount(token_holdings, account) {
  const index = token_holdings.findIndex(
    (item) => item.account === account
  );
  // Add new account if not exist
  if (index === -1) {
    const newItem = createDefaultData();
    newItem.account = account;
    token_holdings.push(newItem);
  }
  return token_holdings.findIndex(
    (item) => item.account === account
  );
}