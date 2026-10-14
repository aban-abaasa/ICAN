import { useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';

// Connects the browser's own crypto wallet (MetaMask, Coinbase Wallet, Rabby, a wallet app's built-in browser, ...) through the
// standard injected provider (EIP-1193). Self-custody: this hook never sees a key, never stores one and never asks for one;
// it can only ASK the wallet, and the wallet asks the person. Nothing is sent to the IcanEra servers by connecting.
//
//   available   a wallet is present in this browser
//   account     the connected address (lower-case), or null
//   chainId     the network the wallet is on, as a number, or null
//   connect()   asks the wallet to share an account (a pop-up in the wallet)
//   switchNetwork(chain)   asks the wallet to move to `chain` ({ chainId, name?, rpcUrl?, explorerUrl? }); adds it if unknown
//   signText(text)         asks the wallet to sign a message (personal_sign): used to prove you hold an address
//   runner      an ethers signer for sending transactions, or null; provider: read-only access through the same wallet
//
// Phones: a wallet app's built-in browser provides this directly. A normal phone browser has none; connecting through
// WalletConnect is a follow-up (the screen says so rather than pretending).

const getInjected = () => {
  if (typeof window === 'undefined') return null;
  const eth = window.ethereum;
  if (!eth) return null;
  // some browsers expose several wallets: prefer one that says it is MetaMask, else the first
  if (Array.isArray(eth.providers) && eth.providers.length) return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
  return eth;
};

const toChainId = (v) => (v == null ? null : Number(typeof v === 'string' && v.startsWith('0x') ? parseInt(v, 16) : v));

export const useWallet = () => {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState(() => !!getInjected());
  const ref = useRef({ browserProvider: null });

  const makeProvider = useCallback(() => {
    const eth = getInjected();
    if (!eth) return null;
    if (!ref.current.browserProvider || ref.current.eth !== eth) {
      ref.current.eth = eth;
      ref.current.browserProvider = new ethers.BrowserProvider(eth, 'any'); // 'any': follow the wallet when the network changes
    }
    return ref.current.browserProvider;
  }, []);

  // pick up an account the person already connected to this site, without a pop-up
  useEffect(() => {
    const eth = getInjected();
    setAvailable(!!eth);
    if (!eth) return undefined;
    let live = true;
    eth.request({ method: 'eth_accounts' }).then((accts) => { if (live) setAccount(accts?.[0] ? String(accts[0]).toLowerCase() : null); }).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then((id) => { if (live) setChainId(toChainId(id)); }).catch(() => {});
    const onAccounts = (accts) => setAccount(accts?.[0] ? String(accts[0]).toLowerCase() : null);
    const onChain = (id) => setChainId(toChainId(id));
    eth.on?.('accountsChanged', onAccounts);
    eth.on?.('chainChanged', onChain);
    return () => { live = false; eth.removeListener?.('accountsChanged', onAccounts); eth.removeListener?.('chainChanged', onChain); };
  }, []);

  const connect = useCallback(async () => {
    const eth = getInjected();
    if (!eth) { setError('No crypto wallet was found in this browser. Install a wallet such as MetaMask, or open this page inside your wallet app.'); return null; }
    setConnecting(true);
    setError('');
    try {
      const accts = await eth.request({ method: 'eth_requestAccounts' });
      const a = accts?.[0] ? String(accts[0]).toLowerCase() : null;
      setAccount(a);
      setChainId(toChainId(await eth.request({ method: 'eth_chainId' })));
      return a;
    } catch (e) {
      setError(e?.code === 4001 ? 'You cancelled the connection in your wallet.' : e?.message || 'Could not connect to your wallet.');
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async (chain) => {
    const eth = getInjected();
    if (!eth || !chain?.chainId) return false;
    const hex = `0x${Number(chain.chainId).toString(16)}`;
    setError('');
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
      return true;
    } catch (e) {
      // 4902: the wallet does not know this network yet. Offer to add it when we know how.
      if ((e?.code === 4902 || /unrecognized chain/i.test(String(e?.message))) && chain.rpcUrl) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: hex, chainName: chain.name || `Chain ${chain.chainId}`, rpcUrls: [chain.rpcUrl], blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : undefined, nativeCurrency: chain.nativeCurrency || { name: 'Ether', symbol: 'ETH', decimals: 18 } }],
          });
          return true;
        } catch (e2) { setError(e2?.code === 4001 ? 'You cancelled adding the network.' : e2?.message || 'Could not add the network.'); return false; }
      }
      setError(e?.code === 4001 ? 'You cancelled the network switch in your wallet.' : 'Your wallet could not switch networks. Switch to the right network in your wallet and try again.');
      return false;
    }
  }, []);

  const signText = useCallback(async (text) => {
    const eth = getInjected();
    if (!eth || !account) throw new Error('Connect your wallet first.');
    return eth.request({ method: 'personal_sign', params: [ethers.hexlify(ethers.toUtf8Bytes(text)), account] });
  }, [account]);

  const getRunner = useCallback(async () => {
    const p = makeProvider();
    return p && account ? p.getSigner(account) : null;
  }, [makeProvider, account]);

  return { available, account, chainId, connecting, error, connect, switchNetwork, signText, getRunner, getProvider: makeProvider, clearError: () => setError('') };
};

export default useWallet;
