import {
  ChainId,
  CHAIN_ID_BSC,
  CHAIN_ID_ETH,
  createNonce,
  getEmitterAddressEth,
  parseSequenceFromLogEth,
} from "@certusone/wormhole-sdk";
import { uint8ArrayToNative } from "@certusone/wormhole-sdk/lib/esm";
import getSignedVAAWithRetry from "@certusone/wormhole-sdk/lib/esm/rpc/getSignedVAAWithRetry";
import { importCoreWasm } from "@certusone/wormhole-sdk/lib/esm/solana/wasm";
import { hexlify, hexStripZeros } from "@ethersproject/bytes";
import { Web3Provider } from "@ethersproject/providers";
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useState } from "react";
import { address as ETH_CONTRACT_ADDRESS } from "./contract-addresses/development";
import { address as BSC_CONTRACT_ADDRESS } from "./contract-addresses/development2";
import { useEthereumProvider } from "./EthereumProviderContext";
import { Messenger__factory } from "./ethers-contracts";
import { useSnackbar } from 'notistack';

interface ParsedVaa {
  consistency_level: number;
  emitter_address: Uint8Array;
  emitter_chain: ChainId;
  guardian_set_index: number;
  nonce: number;
  payload: Uint8Array;
  sequence: number;
  signatures: any;
  timestamp: number;
  version: number;
}

const WORMHOLE_RPC_HOSTS = ["http://localhost:7071"];

const chainToNetworkDec = (c: ChainId) =>
  c === 2 ? 1337 : c === 4 ? 1397 : 0;

const chainToNetwork = (c: ChainId) =>
  hexStripZeros(hexlify(chainToNetworkDec(c)));
  
const chainToContract = (c: ChainId) =>
  c === 2 ? ETH_CONTRACT_ADDRESS : c === 4 ? BSC_CONTRACT_ADDRESS : "";

const chainToName = (c: ChainId) =>
  c === 2
    ? "Ethereum"
    : c === 4
    ? "BSC"
    : "Unknown";

const MM_ERR_WITH_INFO_START =
  "VM Exception while processing transaction: revert ";
const parseError = (e: any) =>
  e?.data?.message?.startsWith(MM_ERR_WITH_INFO_START)
    ? e.data.message.replace(MM_ERR_WITH_INFO_START, "")
    : e?.response?.data?.error // terra error
    ? e.response.data.error
    : e?.message
    ? e.message
    : "An unknown error occurred";

  const switchProviderNetwork = async(provider: Web3Provider, chainId: ChainId) => {
  await provider.send("wallet_switchEthereumChain", [
    { chainId: chainToNetwork(chainId) },
  ]);
  const cNetwork = await provider.getNetwork();
  // This is workaround for when Metamask fails to switch network.
  if(cNetwork.chainId !== chainToNetworkDec(chainId)) {
        console.log('switchProviderNetwork did not work');
        throw new Error("Metamask could not switch network");
  }
}
  
  function Chain({
  name,
  chainId,
  addMessage,
}: {
  name: string;
  chainId: ChainId;
  addMessage: (m: ParsedVaa) => void;
}) {
  const { provider, signer, signerAddress } = useEthereumProvider();
  const [messageText, setMessageText] = useState("");
  const { enqueueSnackbar } = useSnackbar();  //closeSnackbar

  const handleChange = useCallback((event) => {
    setMessageText(event.target.value);
  }, []);
  
  const sendClickHandler = useCallback(() => {
    if (!signer || !provider) return;
    (async () => {
      try {
        await switchProviderNetwork(provider, chainId);
        const sendMsg = Messenger__factory.connect(
          chainToContract(chainId),
          signer
        );
        const nonce = createNonce();
        // Sending message to Wormhole and waiting for it to be signed.
        // 1. Send string transaction. And wait for Receipt.
        // sendStr is defined in example contract Messenger.sol
        const sendTx = await sendMsg.sendStr(
          new Uint8Array(Buffer.from(messageText)),
          nonce
        );
        const sendReceipt = await sendTx.wait();
        // 2. Call into wormhole sdk to get this message sequence.
        // Sequence is specific to originator.
        const sequence = parseSequenceFromLogEth(
          sendReceipt,
          await sendMsg.wormhole()
        );
        // 3. Retrieve signed VAA. For this chain and sequence.
        const { vaaBytes } = await getSignedVAAWithRetry(
          WORMHOLE_RPC_HOSTS,
          chainId,
          getEmitterAddressEth(chainToContract(chainId)),
          sequence.toString()
        );
        // 4. Parse signed VAA and store it for display and use.
        // VAA use example is in part2.
        const { parse_vaa } = await importCoreWasm();
        const parsedVaa = parse_vaa(vaaBytes);
        addMessage(parsedVaa);
      } catch (e) {
        console.log("EXCEPTION in Send: "+ e);
        enqueueSnackbar("EXCEPTION in Send: " + parseError(e), { 
          persist: false,
        });
      }
    })();
  }, [provider, signer, chainId, messageText, addMessage, enqueueSnackbar]);

  return (
    <Card sx={{ m: 2 }}>
      <CardHeader title={name} />
      <CardContent>
        <TextField
          multiline
          fullWidth
          rows="3"
          placeholder="Type a message"
          value={messageText}
          onChange={handleChange}
        />
      </CardContent>
      <CardActions>
        <Button
          onClick={sendClickHandler}
          variant="contained"
          disabled={!signerAddress}
        >
          Send
        </Button>
      </CardActions>
    </Card>
  );
}

function App() {
  const { connect, disconnect, signerAddress } = useEthereumProvider();
  const [messages, setMessages] = useState<ParsedVaa[]>([]);
  const addMessage = useCallback((message: ParsedVaa) => {
    setMessages((arr) => [message, ...arr]);
  }, []);
  return (
    <Box my={2}>
      <Typography variant="h4" component="h1" sx={{ textAlign: "center" }}>
        Send messages via Wormhole
      </Typography>
      <Box sx={{ textAlign: "center", mt: 2, mb: 1 }}>
        {signerAddress ? (
          <Button
            variant="outlined"
            color="inherit"
            onClick={disconnect}
            sx={{ textTransform: "none" }}
          >
            {signerAddress.substr(0, 5)}
            ...
            {signerAddress.substr(signerAddress.length - 3)}
          </Button>
        ) : (
          <Button variant="contained" color="secondary" onClick={connect}>
            Connect Wallet
          </Button>
        )}
      </Box>
      <Box sx={{ display: "flex" }}>
        <Box sx={{ flexBasis: "66%" }}>
          <Chain
            name="Ethereum"
            chainId={CHAIN_ID_ETH}
            addMessage={addMessage}
          ></Chain>
          <Chain
            name="BSC"
            chainId={CHAIN_ID_BSC}
            addMessage={addMessage}
          ></Chain>
        </Box>
        <Box sx={{ flexGrow: 1, p: 2, pl: 0 }}>
          <Card sx={{ width: "100%", height: "100%" }}>
            <CardHeader title="Observed Messages" />
            <CardContent>
              <List>
                {messages.map((message) => {
                    const key = `${chainToName(message.emitter_chain)}-${uint8ArrayToNative(
                    message.emitter_address,
                    message.emitter_chain
                  )}-${message.sequence}`;
                  return (
                    <ListItem key={key} divider>
                      <ListItemText
                        primary={Buffer.from(message.payload).toString()}
                        secondary={key}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Box>
  );
}

export default App;