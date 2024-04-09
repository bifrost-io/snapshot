import { ApiPromise, WsProvider } from "@polkadot/api";
import BigNumber from "bignumber.js";
import fs from "fs";
import { options } from "@bifrost-finance/api";

const VDOT_ID = '{"VToken2":"0"}';
const TOKENS = [
  { token: '{"LPToken":["ASG","8","ASG","9"]}', addr: 'eCSrvaystgdffuJxPVRct68qJUZs1sFz762d7d37KJvb7Pz', name: 'lp_dot_vdot' },
  { token: '{"LPToken":["KUSD","8","ASG","9"]}', addr: 'eCSrvaystgdffuJxPVSiQp5vXbGHHEbgQQQUaVb2ychB9Vz', name: 'lp_vdot_kusd' },
  { token: '{"LPToken":["ASG","9","ASG","10"]}', addr: 'eCSrvaystgdffuJxPVS4SfFvaM26m6tAxwDLPvawBAYbnJd', name: 'lp_vdot_vsdot' },
  { token: '{"BLP":"0"}', addr: 'eCSrvbA5gGNQr7UjcSJz4jSTTD7Ne167hEVNeZFmiXpQJP7', name: 'blp_dot_vdot' },
]

const rpc = "wss://hk.p.bifrost-rpc.liebi.com/ws";
const block = parseInt(process.argv[2]);

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
  console.log("writing vdot-holders.json");
  fs.writeFileSync("data/vdot-holders.json", JSON.stringify(vdot_holdings, 2, 2));
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
  let vdot_pool0 = JSON.parse(JSON.stringify(await apiAt.query.farming.poolInfos(0)));
  let pool4 = JSON.parse(JSON.stringify(await apiAt.query.farming.poolInfos(4)));
  let pool8 = JSON.parse(JSON.stringify(await apiAt.query.farming.poolInfos(8)));
  let pool12 = JSON.parse(JSON.stringify(await apiAt.query.farming.poolInfos(12)));

  let per_share_in_pool0 = BigNumber(vdot_holdings.find((item) => item.account === vdot_pool0.keeper).free)
    .dividedBy(vdot_pool0.totalShares);
  let per_share_in_pool4 = BigNumber(vdot_holdings.find((item) => item.account === pool4.keeper).lp_vdot_vsdot)
    .dividedBy(pool4.totalShares);
  let per_share_in_pool8 = BigNumber(vdot_holdings.find((item) => item.account === pool8.keeper).blp_dot_vdot)
    .dividedBy(pool8.totalShares);
  let per_share_in_pool12 = BigNumber(vdot_holdings.find((item) => item.account === pool12.keeper).lp_vdot_kusd)
    .dividedBy(pool12.totalShares);

  const farming = await apiAt.query.farming.sharesAndWithdrawnRewards.entries();
  const result = farming.map((item) => {
    let value = JSON.parse(JSON.stringify(item[1].toHuman()));
    const pool_id = item[0].toHuman()[0];
    const account = item[0].toHuman()[1];
    const intValue = parseInt(value.share.replace(/,/g, ''), 10);
    const share = intValue;

    const index = getIndexByAccount(vdot_holdings, account);
    switch (pool_id) {
      case '0':
        vdot_holdings[index].pool0 = per_share_in_pool0.multipliedBy(share).toFixed(0);
        vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(vdot_holdings[index].pool0).toFixed(0);
        break;
      case '4':
        vdot_holdings[index].pool4 = per_share_in_pool4.multipliedBy(share).toFixed(0);
        vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(vdot_holdings[index].pool4).toFixed(0);
        break;
      case '8':
        vdot_holdings[index].pool8 = per_share_in_pool8.multipliedBy(share).toFixed(0);
        vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(vdot_holdings[index].pool8).toFixed(0);
        break;
      case '12':
        vdot_holdings[index].pool12 = per_share_in_pool12.multipliedBy(share).toFixed(0);
        vdot_holdings[index].total_vdot = BigNumber(vdot_holdings[index].total_vdot).plus(vdot_holdings[index].pool12).toFixed(0);
        break;
      default:
        break;
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