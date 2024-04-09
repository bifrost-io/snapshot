import { ApiPromise, WsProvider } from "@polkadot/api";
import BigNumber from "bignumber.js";
import fs from "fs";
import { options } from "@bifrost-finance/api";

const DOT_ID = '{"Token2":"0"}';
const VDOT_ID = '{"VToken2":"0"}';
const TOKENS = [
  { token: '{"LPToken":["ASG","8","ASG","9"]}', addr: 'eCSrvaystgdffuJxPVRct68qJUZs1sFz762d7d37KJvb7Pz', name: 'lp_dot_vdot' },
  { token: '{"LPToken":["KUSD","8","ASG","9"]}', addr: 'eCSrvaystgdffuJxPVSiQp5vXbGHHEbgQQQUaVb2ychB9Vz', name: 'lp_vdot_kusd' },
  { token: '{"LPToken":["ASG","9","ASG","10"]}', addr: 'eCSrvaystgdffuJxPVS4SfFvaM26m6tAxwDLPvawBAYbnJd', name: 'lp_vdot_vsdot' },
  { token: '{"BLP":"0"}', addr: 'eCSrvbA5gGNQr7UjcSJz4jSTTD7Ne167hEVNeZFmiXpQJP7', name: 'blp_dot_vdot' },
]
const POOLS = [
  { pool_id: '0', name: 'pool0', field_name: 'free', addr: 'eCSrvbA5gGLejANY2XNJzg7B8cB4mBx8Rbw4tXHpY6GK5YE' },
  { pool_id: '4', name: 'pool4', field_name: 'lp_vdot_vsdot', addr: 'eCSrvbA5gGLejANY2YTH6rTd7JxtybT57MyGfGdfqbBPVdZ' },
  { pool_id: '8', name: 'pool8', field_name: 'blp_dot_vdot', addr: 'eCSrvbA5gGLejANY2ZYFD2p561kjBzx1o81US1yX966U1k4' },
  { pool_id: '12', name: 'pool12', field_name: 'lp_vdot_kusd', addr: 'eCSrvbA5gGLejANY2adDKDAX4iYZQQSxUt3gCmKNSb1YWp4' },
]
const rpc = "wss://hk.p.bifrost-rpc.liebi.com/ws";
const block = parseInt(process.argv[2]);
const dir = process.argv[3] ? process.argv[3] : "data/vdot-holders.json";

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
  const api = await ApiPromise.create(options({ provider: wsProvider }));
  const currentBlock = (await api.rpc.chain.getBlock()).block.header.number;
  const blockHash = await api.rpc.chain.getBlockHash(block || currentBlock);
  const apiAt = await api.at(blockHash);
  console.log(
    `connected, head at #${currentBlock}, fetching token holders at #${block || currentBlock
    }...`
  );
  let vdot_holdings = [];
  await fetchTokenHolders(apiAt, vdot_holdings);
  await fetchFarming(apiAt, vdot_holdings);
  console.log("writing vdot-price.json");
  let price = await fetchPrice(apiAt);
  fs.writeFileSync("data/vdot-price.json", JSON.stringify(price, 2, 2));
  console.log("writing system-account.json");
  let system_account = await removeSystemAccount(vdot_holdings);
  fs.writeFileSync("data/system-account.json", JSON.stringify(system_account, 2, 2));
  console.log(`writing ${dir}`);
  fs.writeFileSync(dir, JSON.stringify(vdot_holdings, 2, 2));
}
main().catch(console.error).finally(() => process.exit());

async function fetchTokenHolders(apiAt, vdot_holdings) {
  let new_tokens = TOKENS;
  for (let i = 0; i < TOKENS.length; i++) {
    let token = TOKENS[i];
    let free = BigNumber((await apiAt.query.tokens.accounts(token.addr, JSON.parse(VDOT_ID))).free);
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

    if (token === VDOT_ID) {
      const index = vdot_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        vdot_holdings[index].free = free;
        vdot_holdings[index].reserved = reserved;
        vdot_holdings[index].frozen = frozen;
        vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(free).toFixed(0);
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        newItem.free = free;
        newItem.reserved = reserved;
        newItem.frozen = frozen;
        newItem.total_vdot = free;
        vdot_holdings.push(newItem);
      }
    } else {
      let new_token = new_tokens.find((item) => item.token === token);
      if (new_token) {
        const index = getIndexByAccount(vdot_holdings, account);
        vdot_holdings[index][new_token.name] = new_token.per_share.multipliedBy(free).toFixed(0);
        vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(vdot_holdings[index][new_token.name]).toFixed(0);
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

async function fetchFarming(apiAt, vdot_holdings) {
  let new_pools = POOLS;
  for (let i = 0; i < POOLS.length; i++) {
    let pool = POOLS[i];
    let poolInfo = JSON.parse(JSON.stringify(await apiAt.query.farming.poolInfos(pool.pool_id)));
    let per_share = BigNumber(vdot_holdings.find((item) => item.account === poolInfo.keeper)[pool.field_name])
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
      const index = getIndexByAccount(vdot_holdings, account);
      vdot_holdings[index][pool.name] = pool.per_share.multipliedBy(share).toFixed(0);
      vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(vdot_holdings[index][pool.name]).toFixed(0);
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

async function fetchPrice(apiAt) {
  let vdot_total_issuance = await apiAt.query.tokens.totalIssuance(JSON.parse(VDOT_ID))
  let token_pool = await apiAt.query.vtokenMinting.tokenPool(JSON.parse(DOT_ID));
  return {
    vdot_price: BigNumber(token_pool).dividedBy(vdot_total_issuance).toFixed(12),
  };
}

function removeSystemAccount(vdot_holdings) {
  let result = [];
  TOKENS.forEach((token) => {
    const index = vdot_holdings.findIndex(
      (item) => item.account === token.addr
    );
    if (index !== -1) {
      result.push(vdot_holdings[index])
      vdot_holdings.splice(index, 1);
    }
  });
  POOLS.forEach((pool) => {
    const index = vdot_holdings.findIndex(
      (item) => item.account === pool.addr
    );
    if (index !== -1) {
      result.push(vdot_holdings[index])
      vdot_holdings.splice(index, 1);
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
    lp_dot_vdot: '0',
    lp_vdot_kusd: '0',
    lp_vdot_vsdot: '0',
    blp_dot_vdot: '0',
    pool0: '0',
    pool4: '0',
    pool8: '0',
    pool12: '0',
    total_vdot: '0',
  };
}

export function getIndexByAccount(vdot_holdings, account) {
  const index = vdot_holdings.findIndex(
    (item) => item.account === account
  );
  // Add new account if not exist
  if (index === -1) {
    const newItem = createDefaultData();
    newItem.account = account;
    vdot_holdings.push(newItem);
  }
  return vdot_holdings.findIndex(
    (item) => item.account === account
  );
}