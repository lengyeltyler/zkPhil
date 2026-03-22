import { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';

import { buildScrollPreviewFeed } from './feed.js';
import { SEPOLIA_PREVIEW_CONFIG } from './config/sepolia.js';

const CARDS_PER_ROW = 4;
const INITIAL_ROWS = 12;
const LOAD_ROWS = 8;
const INITIAL_LENGTH = INITIAL_ROWS * CARDS_PER_ROW;
const LOAD_LENGTH = LOAD_ROWS * CARDS_PER_ROW;
const MAX_INFLIGHT_PREVIEWS = 4;
const QUEUE_DEBOUNCE_MS = 80;
const RPC_STORAGE_KEY = 'phil-scroll-preview-rpc-url';

const RENDERER_ABI = [
  'function renderSvg(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed) view returns (string)',
];

const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'image',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'title',
  'desc',
]);

const ALLOWED_SVG_ATTRS = new Set([
  'xmlns',
  'xmlns:xlink',
  'viewbox',
  'width',
  'height',
  'fill',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'opacity',
  'd',
  'x',
  'y',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'x2',
  'y1',
  'y2',
  'points',
  'href',
  'xlink:href',
  'transform',
  'id',
  'gradientunits',
  'gradienttransform',
  'patternunits',
  'patterntransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'fx',
  'fy',
  'isolation',
  'clip-path',
  'mask',
  'preserveaspectratio',
]);

const ENV_RPC_URL = (
  import.meta.env.VITE_RPC_URL_SEPOLIA
  || import.meta.env.VITE_RPC_URL
  || (typeof __SEPOLIA_RPC_URL__ !== 'undefined' ? __SEPOLIA_RPC_URL__ : '')
  || ''
).trim();

function getItemKey(item) {
  return `${item.philId}:${item.paletteVariant}:${item.mixMode}:${item.mixSeed}`;
}

function readStoredRpcUrl() {
  if (typeof window === 'undefined') return ENV_RPC_URL;
  const saved = window.localStorage.getItem(RPC_STORAGE_KEY) || '';
  return (saved || ENV_RPC_URL).trim();
}

function sanitizeSvgMarkup(rawSvg) {
  if (typeof rawSvg !== 'string' || !rawSvg.includes('<svg')) {
    throw new Error('Renderer returned a non-SVG response.');
  }
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return rawSvg;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Renderer returned malformed SVG.');
  }

  const cleanNode = (node) => {
    const tagName = node.nodeName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tagName)) {
      node.remove();
      return;
    }

    for (const attr of [...node.attributes]) {
      const attrName = attr.name.toLowerCase();
      if (
        attrName.startsWith('on')
        || (!ALLOWED_SVG_ATTRS.has(attrName) && !attrName.startsWith('data-'))
      ) {
        node.removeAttribute(attr.name);
      }
    }

    for (const child of [...node.children]) {
      cleanNode(child);
    }
  };

  cleanNode(svg);
  return new XMLSerializer().serializeToString(svg);
}

function formatParams(item) {
  return JSON.stringify(
    {
      philId: item.philId,
      paletteVariant: item.paletteVariant,
      mixMode: item.mixMode,
      mixSeed: item.mixSeed,
    },
    null,
    2
  );
}

function shortenRpcLabel(rpcUrl) {
  if (!rpcUrl) return '';
  try {
    const parsed = new URL(rpcUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return rpcUrl;
  }
}

export function App() {
  const [rpcInput, setRpcInput] = useState(() => readStoredRpcUrl());
  const [activeRpcUrl, setActiveRpcUrl] = useState(() => readStoredRpcUrl());
  const [providerReady, setProviderReady] = useState(false);
  const [providerStatus, setProviderStatus] = useState(() => (
    readStoredRpcUrl()
      ? 'Checking Sepolia RPC...'
      : 'Paste a Sepolia RPC URL to start the read-only preview.'
  ));
  const [error, setError] = useState('');
  const [feedLength, setFeedLength] = useState(INITIAL_LENGTH);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [, forceRender] = useState(0);

  const previewCacheRef = useRef(new Map());
  const inflightPreviewRef = useRef(new Set());
  const queuedPreviewRef = useRef(new Set());
  const pendingPreviewRef = useRef([]);
  const queueTimerRef = useRef(null);
  const copyTimerRef = useRef(null);
  const sentinelRef = useRef(null);
  const loadLockRef = useRef(false);
  const activeRpcRef = useRef(activeRpcUrl);

  const provider = useMemo(() => {
    if (!activeRpcUrl) return null;
    return new ethers.JsonRpcProvider(activeRpcUrl, undefined, { batchMaxCount: 1 });
  }, [activeRpcUrl]);

  const renderer = useMemo(() => {
    if (!provider || !providerReady || !SEPOLIA_PREVIEW_CONFIG.rendererAddress) return null;
    return new ethers.Contract(SEPOLIA_PREVIEW_CONFIG.rendererAddress, RENDERER_ABI, provider);
  }, [provider, providerReady]);

  const feed = useMemo(() => {
    return buildScrollPreviewFeed({ length: feedLength });
  }, [feedLength]);

  useEffect(() => {
    activeRpcRef.current = activeRpcUrl;
  }, [activeRpcUrl]);

  useEffect(() => {
    previewCacheRef.current.clear();
    inflightPreviewRef.current.clear();
    queuedPreviewRef.current.clear();
    pendingPreviewRef.current = [];
    if (queueTimerRef.current) {
      window.clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
    forceRender((value) => value + 1);
  }, [activeRpcUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!provider || !activeRpcUrl) {
      setProviderReady(false);
      setProviderStatus('Paste a Sepolia RPC URL to start the read-only preview.');
      return () => {};
    }

    if (!SEPOLIA_PREVIEW_CONFIG.rendererAddress) {
      setProviderReady(false);
      setProviderStatus('Missing Sepolia deployment manifest for PhilRenderer.');
      return () => {};
    }

    setProviderReady(false);
    setProviderStatus('Checking Sepolia RPC...');

    provider.getNetwork()
      .then((network) => {
        if (cancelled) return;
        const chainId = Number(network.chainId);
        if (chainId !== SEPOLIA_PREVIEW_CONFIG.chainId) {
          setProviderReady(false);
          setProviderStatus(
            `RPC chain mismatch: expected ${SEPOLIA_PREVIEW_CONFIG.chainId}, got ${chainId}.`
          );
          return;
        }

        setProviderReady(true);
        setProviderStatus(`Connected to Sepolia via ${shortenRpcLabel(activeRpcUrl)}`);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(RPC_STORAGE_KEY, activeRpcUrl);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setProviderReady(false);
        setProviderStatus(err?.message || 'Unable to connect to the provided RPC URL.');
      });

    return () => {
      cancelled = true;
    };
  }, [provider, activeRpcUrl]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return () => {};

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (!visible || loadLockRef.current) return;
      loadLockRef.current = true;
      setLoadingMore(true);
      setFeedLength((current) => current + LOAD_LENGTH);
    }, {
      root: null,
      rootMargin: '1200px 0px',
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

  useEffect(() => {
    if (!renderer || !providerReady) return;

    const loadPreview = async (item) => {
      const key = getItemKey(item);
      const rpcSnapshot = activeRpcRef.current;

      try {
        const rawSvg = await renderer.renderSvg(
          item.philId,
          item.paletteVariant,
          item.mixMode,
          item.mixSeed
        );
        if (rpcSnapshot !== activeRpcRef.current) return;

        previewCacheRef.current.set(key, {
          svg: sanitizeSvgMarkup(rawSvg),
        });
        setError('');
        forceRender((value) => value + 1);
      } catch (err) {
        if (rpcSnapshot !== activeRpcRef.current) return;

        previewCacheRef.current.set(key, {
          error: err?.message || String(err),
        });
        setError(err?.message || String(err));
        forceRender((value) => value + 1);
      }
    };

    const pumpQueue = () => {
      if (!renderer || !providerReady) return;

      while (
        inflightPreviewRef.current.size < MAX_INFLIGHT_PREVIEWS
        && pendingPreviewRef.current.length > 0
      ) {
        const item = pendingPreviewRef.current.shift();
        const key = getItemKey(item);
        queuedPreviewRef.current.delete(key);
        inflightPreviewRef.current.add(key);

        void loadPreview(item).finally(() => {
          inflightPreviewRef.current.delete(key);
          if (!queueTimerRef.current) {
            queueTimerRef.current = window.setTimeout(() => {
              queueTimerRef.current = null;
              pumpQueue();
            }, QUEUE_DEBOUNCE_MS);
          }
        });
      }
    };

    const queuePreview = (item) => {
      const key = getItemKey(item);
      if (
        previewCacheRef.current.has(key)
        || inflightPreviewRef.current.has(key)
        || queuedPreviewRef.current.has(key)
      ) {
        return;
      }

      pendingPreviewRef.current.push(item);
      queuedPreviewRef.current.add(key);

      if (!queueTimerRef.current) {
        queueTimerRef.current = window.setTimeout(() => {
          queueTimerRef.current = null;
          pumpQueue();
        }, QUEUE_DEBOUNCE_MS);
      }
    };

    const start = Math.max(0, feed.items.length - (LOAD_LENGTH * 2));
    for (const item of feed.items.slice(start)) {
      queuePreview(item);
    }

    return () => {
      if (queueTimerRef.current) {
        window.clearTimeout(queueTimerRef.current);
        queueTimerRef.current = null;
      }
    };
  }, [feed.items, providerReady, renderer]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      if (queueTimerRef.current) {
        window.clearTimeout(queueTimerRef.current);
      }
    };
  }, []);

  async function copyParams(item) {
    const key = getItemKey(item);
    const payload = formatParams(item);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(payload);
    } catch {
      window.prompt('Copy preview params:', payload);
    }

    setCopiedKey(key);
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedKey('');
    }, 1400);
  }

  function applyRpcUrl() {
    setError('');
    const nextRpcUrl = rpcInput.trim();
    if (!nextRpcUrl && typeof window !== 'undefined') {
      window.localStorage.removeItem(RPC_STORAGE_KEY);
    }
    setActiveRpcUrl(nextRpcUrl);
  }

  const sentinelMessage = !providerReady
    ? 'Connect a Sepolia RPC to start loading previews'
    : loadingMore
      ? 'Loading more on-chain previews...'
      : 'Scroll for more on-chain combinations';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="heading-block">
          <div className="mode-pill">Scroll Preview</div>
          <h1>zkPhil Sepolia Read-Only Browser</h1>
          <p className="subhead">
            Infinite, deterministic previews from the current Phil renderer now backed by
            `zkPhilLayers` on Sepolia. No wallet. No signing. No minting.
          </p>
        </div>

        <div className="rpc-panel">
          <label className="rpc-label" htmlFor="rpcUrlInput">Sepolia RPC URL</label>
          <div className="rpc-row">
            <input
              id="rpcUrlInput"
              className="rpc-input"
              type="text"
              value={rpcInput}
              onChange={(event) => setRpcInput(event.target.value)}
              placeholder="https://your-sepolia-rpc.example"
              spellCheck="false"
              autoComplete="off"
            />
            <button className="apply-button" type="button" onClick={applyRpcUrl}>
              Use RPC
            </button>
          </div>
          <div className={`status-line ${providerReady ? 'ok' : 'idle'}`}>
            {providerStatus}
          </div>
        </div>
      </header>

      <section className="network-panel">
        <div className="network-copy">
          <span className="network-label">Chain</span>
          <strong>Sepolia ({SEPOLIA_PREVIEW_CONFIG.chainId})</strong>
        </div>
        <div className="address-grid">
          <div className="address-card">
            <span className="network-label">PhilRenderer</span>
            <code>{SEPOLIA_PREVIEW_CONFIG.rendererAddress}</code>
          </div>
          <div className="address-card">
            <span className="network-label">PhilIdentityMint</span>
            <code>{SEPOLIA_PREVIEW_CONFIG.philIdentityMintAddress}</code>
          </div>
          <div className="address-card">
            <span className="network-label">PhilWeb3</span>
            <code>{SEPOLIA_PREVIEW_CONFIG.web3Address}</code>
          </div>
          <div className="address-card">
            <span className="network-label">PhilLayerRegistry</span>
            <code>{SEPOLIA_PREVIEW_CONFIG.layerRegistryAddress}</code>
          </div>
          <div className="address-card">
            <span className="network-label">PhilSVGStorage</span>
            <code>{SEPOLIA_PREVIEW_CONFIG.svgStorageAddress}</code>
          </div>
        </div>
      </section>

      <main>
        <section className="gallery-grid">
          {feed.items.map((item) => {
            const key = getItemKey(item);
            const preview = previewCacheRef.current.get(key);
            const showCopied = copiedKey === key;

            return (
              <article key={item.key} className="gallery-card">
                <div className="gallery-art">
                  {preview?.svg ? (
                    <div className="gallery-image" dangerouslySetInnerHTML={{ __html: preview.svg }} />
                  ) : (
                    <div className="loading-card">
                      {providerReady ? 'Rendering on-chain preview...' : 'Waiting for Sepolia RPC...'}
                    </div>
                  )}
                </div>

                <div className="card-body">
                  <div className="param-line">
                    <span>philId</span>
                    <strong>{item.philId}</strong>
                  </div>
                  <div className="param-line">
                    <span>paletteVariant</span>
                    <strong>{item.paletteVariant}</strong>
                  </div>
                  <div className="param-line">
                    <span>mixMode</span>
                    <strong>{item.mixMode}</strong>
                  </div>
                  <div className="param-line">
                    <span>mixSeed</span>
                    <strong>{item.mixSeed}</strong>
                  </div>

                  {preview?.error ? (
                    <div className="card-error">{preview.error}</div>
                  ) : null}

                  <button
                    className="copy-button"
                    type="button"
                    onClick={() => void copyParams(item)}
                  >
                    {showCopied ? 'Copied' : 'Copy Params'}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <div ref={sentinelRef} className="sentinel">
          {sentinelMessage}
        </div>
      </main>

      {error ? <div className="error-line">{error}</div> : null}
    </div>
  );
}
