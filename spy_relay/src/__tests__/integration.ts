import {
  attestFromSolana,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  createWrappedOnEth,
  getEmitterAddressSolana,
  // getIsTransferCompletedEth,
  hexToUint8Array,
  nativeToHexString,
  parseSequenceFromLogSolana,
  transferFromSolana,
  uint8ArrayToHex,
} from "@certusone/wormhole-sdk";

import getSignedVAAWithRetry from "@certusone/wormhole-sdk/lib/cjs/rpc/getSignedVAAWithRetry";
import { setDefaultWasm } from "@certusone/wormhole-sdk/lib/cjs/solana/wasm";

import { parseUnits } from "@ethersproject/units";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import { describe, expect, jest, test } from "@jest/globals";

import { ethers } from "ethers";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import axios from "axios";
import {
  ETH_NODE_URL,
  ETH_PRIVATE_KEY,
  ETH_PUBLIC_KEY,
  ETH_TOKEN_BRIDGE_ADDRESS,
  SOLANA_CORE_BRIDGE_ADDRESS,
  SOLANA_HOST,
  SOLANA_PRIVATE_KEY,
  SOLANA_TOKEN_BRIDGE_ADDRESS,
  SPY_RELAY_URL,
  TEST_SOLANA_TOKEN,
  WORMHOLE_RPC_HOSTS,
} from "./consts";

setDefaultWasm("node");

jest.setTimeout(60000);

test("Verify Spy Relay is running", (done) => {
  (async () => {
    try {
      console.log(
        "Sending query to spy relay to see if it's running, query: [%s]",
        SPY_RELAY_URL
      );

      const result = await axios.get(SPY_RELAY_URL);

      expect(result).toHaveProperty("status");
      expect(result.status).toBe(200);

      done();
    } catch (e) {
      console.error("Spy Relay does not appear to be running!");
      console.error(e);
      done("Spy Relay does not appear to be running!");
    }
  })();
});

var sequence: string;
var emitterAddress: string;

describe("Solana to Ethereum", () => {
  test("Attest Solana SPL to Ethereum", (done) => {
    (async () => {
      console.log("Attest Solana SPL to Ethereum");
      try {
        // create a keypair for Solana
        const keypair = Keypair.fromSecretKey(SOLANA_PRIVATE_KEY);
        const payerAddress = keypair.publicKey.toString();
        // attest the test token
        const connection = new Connection(SOLANA_HOST, "confirmed");
        const transaction = await attestFromSolana(
          connection,
          SOLANA_CORE_BRIDGE_ADDRESS,
          SOLANA_TOKEN_BRIDGE_ADDRESS,
          payerAddress,
          TEST_SOLANA_TOKEN
        );
        // sign, send, and confirm transaction
        transaction.partialSign(keypair);
        const txid = await connection.sendRawTransaction(
          transaction.serialize()
        );
        await connection.confirmTransaction(txid);
        const info = await connection.getTransaction(txid);
        if (!info) {
          throw new Error(
            "An error occurred while fetching the transaction info"
          );
        }
        // get the sequence from the logs (needed to fetch the vaa)
        const sequence = parseSequenceFromLogSolana(info);
        emitterAddress = await getEmitterAddressSolana(
          SOLANA_TOKEN_BRIDGE_ADDRESS
        );
        // poll until the guardian(s) witness and sign the vaa
        const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
          WORMHOLE_RPC_HOSTS,
          CHAIN_ID_SOLANA,
          emitterAddress,
          sequence,
          {
            transport: NodeHttpTransport(),
          }
        );
        // create a signer for Eth
        const provider = new ethers.providers.WebSocketProvider(ETH_NODE_URL);
        const signer = new ethers.Wallet(ETH_PRIVATE_KEY, provider);
        try {
          await createWrappedOnEth(ETH_TOKEN_BRIDGE_ADDRESS, signer, signedVAA);
        } catch (e) {
          // this could fail because the token is already attested (in an unclean env)
        }
        provider.destroy();
        done();
      } catch (e) {
        console.error(e);
        done(
          "An error occurred while trying to attest from Solana to Ethereum"
        );
      }
    })();
  });

  // TODO: it is attested
  test("Send Solana SPL to Ethereum", (done) => {
    (async () => {
      console.log("Send Solana SPL to Ethereum");
      try {
        // create a signer for Eth
        const provider = new ethers.providers.WebSocketProvider(ETH_NODE_URL);
        const signer = new ethers.Wallet(ETH_PRIVATE_KEY, provider);
        const targetAddress = await signer.getAddress();
        // create a keypair for Solana
        const keypair = Keypair.fromSecretKey(SOLANA_PRIVATE_KEY);
        const payerAddress = keypair.publicKey.toString();
        // find the associated token account
        const fromAddress = (
          await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            new PublicKey(TEST_SOLANA_TOKEN),
            keypair.publicKey
          )
        ).toString();
        // transfer the test token
        const connection = new Connection(SOLANA_HOST, "confirmed");
        const amount = parseUnits("1", 9).toBigInt();
        const transaction = await transferFromSolana(
          connection,
          SOLANA_CORE_BRIDGE_ADDRESS,
          SOLANA_TOKEN_BRIDGE_ADDRESS,
          payerAddress,
          fromAddress,
          TEST_SOLANA_TOKEN,
          amount,
          hexToUint8Array(nativeToHexString(targetAddress, CHAIN_ID_ETH) || ""),
          CHAIN_ID_ETH
        );
        // sign, send, and confirm transaction
        console.log("Sending transaction.");
        transaction.partialSign(keypair);
        const txid = await connection.sendRawTransaction(
          transaction.serialize()
        );
        console.log("Confirming transaction.");
        await connection.confirmTransaction(txid);
        const info = await connection.getTransaction(txid);
        if (!info) {
          throw new Error(
            "An error occurred while fetching the transaction info"
          );
        }
        // get the sequence from the logs (needed to fetch the vaa)
        console.log("Parsing sequence number from log.");
        sequence = parseSequenceFromLogSolana(info);
        const emitterAddress = await getEmitterAddressSolana(
          SOLANA_TOKEN_BRIDGE_ADDRESS
        );
        // poll until the guardian(s) witness and sign the vaa
        console.log("Waiting on signed vaa, sequence %d", sequence);
        const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
          WORMHOLE_RPC_HOSTS,
          CHAIN_ID_SOLANA,
          emitterAddress,
          sequence,
          {
            transport: NodeHttpTransport(),
          }
        );
        console.log("Got signed vaa: ", signedVAA);
        // expect(
        //   await getIsTransferCompletedEth(
        //     ETH_TOKEN_BRIDGE_ADDRESS,
        //     provider,
        //     signedVAA
        //   )
        // ).toBe(false);
        provider.destroy();
        done();
      } catch (e) {
        console.error(e);
        done("An error occurred while trying to send from Solana to Ethereum");
      }
    })();
  });

  test("Query Spy Relay via REST", (done) => {
    (async () => {
      var storeKey: string =
        CHAIN_ID_SOLANA.toString() +
        "/" +
        emitterAddress +
        "/" +
        sequence.toString();
      try {
        var query: string = SPY_RELAY_URL + "/query/" + storeKey;
        console.log("Sending query to spy relay, query: [%s]", query);
        const result = await axios.get(query);
        console.log(
          "status: ",
          result.status,
          ", statusText: ",
          result.statusText,
          ", data: ",
          result.data
        );

        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("data");

        console.log(result.data);
        done();
      } catch (e) {
        console.error(e);
        done("An error occurred while trying to send query to spy relay");
      }
    })();
  });
});