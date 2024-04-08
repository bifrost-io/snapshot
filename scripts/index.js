import { ApiPromise, WsProvider } from "@polkadot/api";
import BigNumber from "bignumber.js";
import fs from "fs";
import { options } from "@bifrost-finance/api";

const DOT_ID = '{"Token2":"0"}';
const VDOT_ID = '{"VToken2":"0"}';
const LP_DOT_VDOT = '{"LPToken":["ASG","8","ASG","9"]}';
const LP_VDOT_KUSD = '{"LPToken":["KUSD","8","ASG","9"]}';
const LP_VDOT_VSDOT = '{"LPToken":["ASG","9","ASG","10"]}';
const BLP_DOT_VDOT = '{"BLP":"0"}';
const ADDR_LP_DOT_VDOT = 'eCSrvaystgdffuJxPVRct68qJUZs1sFz762d7d37KJvb7Pz';
const ADDR_LP_VDOT_KUSD = 'eCSrvaystgdffuJxPVSiQp5vXbGHHEbgQQQUaVb2ychB9Vz';
const ADDR_LP_VDOT_VSDOT = 'eCSrvaystgdffuJxPVS4SfFvaM26m6tAxwDLPvawBAYbnJd';
const ADDR_BLP_DOT_VDOT = 'eCSrvbA5gGNQr7UjcSJz4jSTTD7Ne167hEVNeZFmiXpQJP7';

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
  await fetchFarming(apiAt);
  console.log("writing vdot-holders.json");
  fs.writeFileSync("data/vdot-holders.json", JSON.stringify(vdot_holdings, 2, 2));
}
main().catch(console.error).finally(() => process.exit());

async function fetchTokenHolders(apiAt, vdot_holdings) {
  let lp_dot_vdot = BigNumber((await apiAt.query.tokens.accounts(ADDR_LP_DOT_VDOT, JSON.parse(VDOT_ID))).free);
  let lp_vdot_kusd = BigNumber((await apiAt.query.tokens.accounts(ADDR_LP_VDOT_KUSD, JSON.parse(VDOT_ID))).free);
  let blp_dot_vdot = BigNumber((await apiAt.query.tokens.accounts(ADDR_BLP_DOT_VDOT, JSON.parse(VDOT_ID))).free);
  let lp_vdot_vsdot = BigNumber((await apiAt.query.tokens.accounts(ADDR_LP_VDOT_VSDOT, JSON.parse(VDOT_ID))).free);
  let per_lp_dot_vdot = lp_dot_vdot.dividedBy(await apiAt.query.tokens.totalIssuance(JSON.parse(LP_DOT_VDOT)));
  let per_blp_dot_vdot = blp_dot_vdot.dividedBy(await apiAt.query.tokens.totalIssuance(JSON.parse(BLP_DOT_VDOT)));
  let per_lp_vdot_kusd = lp_vdot_kusd.dividedBy(await apiAt.query.tokens.totalIssuance(JSON.parse(LP_VDOT_KUSD)));
  let per_lp_vdot_vsdot = lp_vdot_vsdot.dividedBy(await apiAt.query.tokens.totalIssuance(JSON.parse(LP_VDOT_VSDOT)));

  const tokensAccount = await apiAt.query.tokens.accounts.entries();
  const result = tokensAccount.map((item) => {
    const account = item[0].toHuman()[0];
    const token = JSON.stringify(item[0].toHuman()[1]);
    const free = BigNumber(item[1].free).toString();
    const reserved = BigNumber(item[1].reserved).toString();
    const frozen = BigNumber(item[1].frozen).toString();
    if (token === VDOT_ID) {
      // console.log("VDOT_ID");
      const index = vdot_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        vdot_holdings[index].free = free;
        vdot_holdings[index].reserved = reserved;
        vdot_holdings[index].frozen = frozen;
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        newItem.free = free;
        newItem.reserved = reserved;
        newItem.frozen = frozen;
        vdot_holdings.push(newItem);
      }
    } else if (token === LP_DOT_VDOT) {
      console.log("LP_DOT_VDOT");
      console.log(vdot_holdings.findIndex((item) => item.account === account));

      const index = vdot_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        // vdot_holdings[index].free = free;
        // vdot_holdings[index].reserved = reserved;
        // vdot_holdings[index].frozen = frozen;
        vdot_holdings[index].lp_dot_vdot = per_lp_dot_vdot.multipliedBy(free).toFixed(0);
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        // newItem.free = free;
        // newItem.reserved = reserved;
        // newItem.frozen = frozen;
        newItem.lp_dot_vdot = per_lp_dot_vdot.multipliedBy(free).toFixed(0);
        vdot_holdings.push(newItem);
      }
    } else if (token === LP_VDOT_KUSD) {
      console.log("LP_VDOT_KUSD");
      console.log(vdot_holdings.findIndex((item) => item.account === account));

      const index = vdot_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        vdot_holdings[index].lp_vdot_kusd = per_lp_vdot_kusd.multipliedBy(free).toFixed(0);
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        newItem.lp_vdot_kusd = per_lp_vdot_kusd.multipliedBy(free).toFixed(0);
        vdot_holdings.push(newItem);
      }
    } else if (token === LP_VDOT_VSDOT) {
      console.log("LP_VDOT_VSDOT");
      console.log(vdot_holdings.findIndex((item) => item.account === account));

      const index = vdot_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        vdot_holdings[index].lp_vdot_vsdot = per_lp_vdot_vsdot.multipliedBy(free).toFixed(0);
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        newItem.lp_vdot_vsdot = per_lp_vdot_vsdot.multipliedBy(free).toFixed(0);
        vdot_holdings.push(newItem);
      }
    } else if (token === BLP_DOT_VDOT) {
      console.log("BLP_DOT_VDOT");
      console.log(vdot_holdings.findIndex((item) => item.account === account));

      const index = vdot_holdings.findIndex(
        (item) => item.account === account
      );
      if (index !== -1) {
        vdot_holdings[index].blp_dot_vdot = per_blp_dot_vdot.multipliedBy(free).toFixed(0);
      } else {
        const newItem = createDefaultData();
        newItem.account = account;
        newItem.blp_dot_vdot = per_blp_dot_vdot.multipliedBy(free).toFixed(0);
        vdot_holdings.push(newItem);
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

async function fetchFarming(apiAt) {
  const farming = await apiAt.query.farming.sharesAndWithdrawnRewards.entries();
  const result = farming.map((item) => {
    let value = JSON.parse(JSON.stringify(item[1].toHuman()));
    const pool_id = item[0].toHuman()[0];
    const account = item[0].toHuman()[1];
    const intValue = parseInt(value.share.replace(/,/g, ''), 10);
    const share = intValue;
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
  };
}