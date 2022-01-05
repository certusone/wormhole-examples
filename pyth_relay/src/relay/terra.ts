import { fromUint8Array } from "js-base64";
import {
  LCDClient,
  LCDClientConfig,
  MnemonicKey,
  MsgExecuteContract,
} from "@terra-money/terra.js";
import { hexToUint8Array } from "@certusone/wormhole-sdk";
import { redeemOnTerra } from "@certusone/wormhole-sdk";

import { logger } from "../helpers";

export type TerraConnectionData = {
  nodeUrl: string;
  terraChainId: string;
  terraName: string;
  walletPrivateKey: string;
  coin: string;
  contractAddress: string;
  lcdConfig: LCDClientConfig;
};

export function connectToTerra(): TerraConnectionData {
  if (!process.env.TERRA_NODE_URL) {
    logger.error("Missing environment variable TERRA_NODE_URL");
    process.exit(1);
  }

  if (!process.env.TERRA_CHAIN_ID) {
    logger.error("Missing environment variable TERRA_CHAIN_ID");
    process.exit(1);
  }

  if (!process.env.TERRA_NAME) {
    logger.error("Missing environment variable TERRA_NAME");
    process.exit(1);
  }

  if (!process.env.TERRA_PRIVATE_KEY) {
    logger.error("Missing environment variable TERRA_PRIVATE_KEY");
    process.exit(1);
  }

  if (!process.env.TERRA_COIN) {
    logger.error("Missing environment variable TERRA_COIN");
    process.exit(1);
  }

  if (!process.env.TERRA_PYTH_CONTRACT_ADDRESS) {
    logger.error("Missing environment variable TERRA_PYTH_CONTRACT_ADDRESS");
    process.exit(1);
  }

  logger.info(
    "Terra connection parameters: url: [" +
      process.env.TERRA_NODE_URL +
      "], terraChainId: [" +
      process.env.TERRA_CHAIN_ID +
      "], terraName: [" +
      process.env.TERRA_NAME +
      "], coin: [" +
      process.env.TERRA_COIN +
      "], contractAddress: [" +
      process.env.TERRA_PYTH_CONTRACT_ADDRESS +
      "]"
  );

  const lcdConfig = {
    URL: process.env.TERRA_NODE_URL,
    chainID: process.env.TERRA_CHAIN_ID,
    name: process.env.TERRA_NAME,
  };

  return {
    nodeUrl: process.env.TERRA_NODE_URL,
    terraChainId: process.env.TERRA_CHAIN_ID,
    terraName: process.env.TERRA_NAME,
    walletPrivateKey: process.env.TERRA_PRIVATE_KEY,
    coin: process.env.TERRA_COIN,
    contractAddress: process.env.TERRA_PYTH_CONTRACT_ADDRESS,
    lcdConfig: lcdConfig,
  };
}

export async function relayTerra(
  connectionData: TerraConnectionData,
  signedVAAs: Array<string>
) {
  logger.debug("relaying " + signedVAAs.length + " messages to terra");

  logger.debug("TIME: connecting to terra");
  const lcdClient = new LCDClient(connectionData.lcdConfig);

  const mk = new MnemonicKey({
    mnemonic: connectionData.walletPrivateKey,
  });

  const wallet = lcdClient.wallet(mk);

  logger.debug("TIME: creating messages");
  var msgs = new Array<MsgExecuteContract>();
  for (var idx = 0; idx < signedVAAs.length; ++idx) {
    const signedVaaArray = hexToUint8Array(signedVAAs[idx]);
    // It is not a bug to call redeem here, since it creates a submit_vaa message, which is what we want.
    const msg = await redeemOnTerra(
      connectionData.contractAddress,
      wallet.key.accAddress,
      signedVaaArray
    );

    msgs.push(msg);
  }

  logger.debug("TIME: looking up gas");
  //Alternate FCD methodology
  //let gasPrices = await axios.get("http://localhost:3060/v1/txs/gas_prices").then((result) => result.data);
  const gasPrices = lcdClient.config.gasPrices;

  logger.debug("TIME: estimating fees");
  //const walletSequence = await wallet.sequence();
  const feeEstimate = await lcdClient.tx.estimateFee(
    wallet.key.accAddress,
    msgs,
    {
      //TODO figure out type mismatch
      feeDenoms: [connectionData.coin],
      gasPrices,
    }
  );

  logger.debug("TIME: creating transaction");
  const tx = await wallet.createAndSignTx({
    msgs: msgs,
    memo: "Pyth Price Attestation",
    feeDenoms: [connectionData.coin],
    gasPrices,
    fee: feeEstimate,
  });

  logger.debug("TIME: sending msg");
  const receipt = await lcdClient.tx.broadcast(tx);
  logger.debug("TIME: done");
  logger.debug("TIME:submitted to terra: receipt: %o", receipt);
  return receipt;
}

export async function queryTerra(
  connectionData: TerraConnectionData,
  productIdStr: string,
  priceIdStr: string
) {
  const encodedProductId = fromUint8Array(hexToUint8Array(productIdStr));
  const encodedPriceId = fromUint8Array(hexToUint8Array(priceIdStr));

  logger.info(
    "Querying terra for price info for productId [" +
      productIdStr +
      "], encoded as [" +
      encodedProductId +
      "], priceId [" +
      priceIdStr +
      "], encoded as [" +
      encodedPriceId +
      "]"
  );

  const lcdClient = new LCDClient(connectionData.lcdConfig);

  const mk = new MnemonicKey({
    mnemonic: connectionData.walletPrivateKey,
  });

  const wallet = lcdClient.wallet(mk);

  const query_result = await lcdClient.wasm.contractQuery(
    connectionData.contractAddress,
    {
      price_info: {
        product_id: encodedProductId,
        price_id: encodedPriceId,
      },
    }
  );

  logger.debug("queryTerra: query returned: %o", query_result);
  return query_result;
}

export async function queryBalanceOnTerra(connectionData: TerraConnectionData) {
  const lcdClient = new LCDClient(connectionData.lcdConfig);

  const mk = new MnemonicKey({
    mnemonic: connectionData.walletPrivateKey,
  });

  const wallet = lcdClient.wallet(mk);

  var balance: number = NaN;
  try {
    logger.debug("querying wallet balance");
    var coins = await lcdClient.bank.balance(wallet.key.accAddress);
    logger.debug("wallet query returned: %o", coins);
    if (coins) {
      var coin = coins.get(connectionData.coin);
      if (coin) {
        balance = parseInt(coin.toData().amount);
      } else {
        logger.error(
          "failed to query coin balance, coin [" +
            connectionData.coin +
            "] is not in the wallet, coins: %o",
          coins
        );
      }
    } else {
      logger.error("failed to query coin balance!");
    }
  } catch (e) {
    logger.error("failed to query coin balance: %o", e);
  }

  return balance;
}
