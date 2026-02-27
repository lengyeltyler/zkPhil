import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';

import { buildFeedSequence, FEED_DEFAULTS, normalizeSeed } from './feed.js';

const CARDS_PER_ROW = 5;
const INITIAL_ROWS = 12;
const LOAD_ROWS = 8;
const INITIAL_LENGTH = INITIAL_ROWS * CARDS_PER_ROW;
const LOAD_LENGTH = LOAD_ROWS * CARDS_PER_ROW;

function getItemKey(item) {
  return `${item.philId}:${item.paletteVariant}:${item.mixMode}:${item.mixSeed}`;
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const out = new Uint32Array(1);
    globalThis.crypto.getRandomValues(out);
    return normalizeSeed(out[0]);
  }
  return normalizeSeed(Date.now());
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload?.error || `request failed: ${response.status}`);
  }
  return payload;
}

export function App() {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  const [feedSeed] = useState(() => randomSeed());
  const [feedLength, setFeedLength] = useState(INITIAL_LENGTH);
  const [loadingMore, setLoadingMore] = useState(false);
  const [, forceRender] = useState(0);

  const previewCacheRef = useRef(new Map());
  const inflightPreviewRef = useRef(new Set());
  const sentinelRef = useRef(null);
  const loadLockRef = useRef(false);

  const feed = useMemo(() => {
    return buildFeedSequence({
      feedSeed,
      length: feedLength,
      mixPercent: FEED_DEFAULTS.mixPercent,
    });
  }, [feedSeed, feedLength]);

  const connectWallet = useCallback(async () => {
    setError('');
    if (!globalThis.window?.ethereum) {
      setError('Wallet not found. Install MetaMask and reload.');
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(globalThis.window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      const connectedAddress = await signer.getAddress();
      setAddress(connectedAddress);
    } catch (err) {
      setError(err?.message || 'Failed to connect wallet.');
    }
  }, []);

  useEffect(() => {
    const wallet = globalThis.window?.ethereum;
    if (!wallet?.on) return () => {};

    const onAccountsChanged = (accounts) => {
      if (!Array.isArray(accounts) || accounts.length === 0) {
        setAddress('');
        return;
      }
      setAddress(accounts[0]);
    };

    wallet.on('accountsChanged', onAccountsChanged);

    return () => {
      wallet.removeListener?.('accountsChanged', onAccountsChanged);
    };
  }, []);

  const loadPreview = useCallback(async (item) => {
    if (!item) return;
    const key = getItemKey(item);
    if (previewCacheRef.current.has(key) || inflightPreviewRef.current.has(key)) return;

    inflightPreviewRef.current.add(key);
    try {
      const params = new URLSearchParams({
        philId: String(item.philId),
        paletteVariant: String(item.paletteVariant),
        mixMode: String(item.mixMode),
        mixSeed: String(item.mixSeed),
      });
      const result = await apiJson(`/api/render?${params.toString()}`);
      previewCacheRef.current.set(key, result.svg);
      forceRender((value) => value + 1);
    } finally {
      inflightPreviewRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    const targets = feed.items.slice(Math.max(0, feed.items.length - (LOAD_LENGTH * 2)));
    void Promise.all(targets.map((item) => loadPreview(item))).catch((err) => {
      setError(err?.message || String(err));
    });
  }, [feed.items, loadPreview]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return () => {};

    const observer = new IntersectionObserver((entries) => {
      const seen = entries.some((entry) => entry.isIntersecting);
      if (!seen || loadLockRef.current) return;
      loadLockRef.current = true;
      setLoadingMore(true);
      setFeedLength((value) => value + LOAD_LENGTH);
    }, {
      root: null,
      rootMargin: '900px 0px',
      threshold: 0,
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loadingMore) return;
    loadLockRef.current = false;
    setLoadingMore(false);
  }, [feedLength, loadingMore]);

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Phil Mint</h1>
        <button className="connect-button" onClick={connectWallet}>
          {address ? 'Wallet Connected' : 'Connect Wallet'}
        </button>
      </header>

      <main>
        <section className="gallery-grid">
          {feed.items.map((item) => {
            const key = getItemKey(item);
            const svg = previewCacheRef.current.get(key) || '';

            return (
              <article key={item.key} className="gallery-card">
                {svg ? (
                  <div className="gallery-image" dangerouslySetInnerHTML={{ __html: svg }} />
                ) : (
                  <div className="loading-card">Loading</div>
                )}
              </article>
            );
          })}
        </section>

        <div ref={sentinelRef} className="sentinel">
          {loadingMore ? 'Loading more combinations...' : 'Scroll for more combinations'}
        </div>
      </main>
      {error ? <div className="error-line">{error}</div> : null}
    </div>
  );
}
