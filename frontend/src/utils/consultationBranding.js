import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { resolveMediaValue, isR2Key } from '../services/r2StorageService';

// Business logo + QR plumbing shared by every CMMS consultation-form surface:
// the public form, the staff builder, the print windows, the PDFs and the QR
// flyer. The logo arrives as whatever the DB holds — an "r2://<key>" marker
// (resolved to a live presigned URL) or a plain https URL — so everything here
// goes through resolveMediaValue first, and every function degrades to "no
// logo" rather than throwing: a form must never fail to print because a logo
// would not load.

// Resolves a stored logo value to a viewable URL, or '' when there is none.
export const resolveLogoUrl = async (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const resolved = await resolveMediaValue(raw);
    return resolved && !isR2Key(resolved) ? resolved : '';
  } catch {
    return '';
  }
};

// <img>-ready logo URL that follows `raw` as it loads / changes.
export const useResolvedLogo = (raw) => {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    setUrl('');
    if (raw) resolveLogoUrl(raw).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [raw]);
  return url;
};

const loadImageElement = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('image failed to load'));
  img.src = src;
});

const blobToImage = async (blob) => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadImageElement(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

// Downloads an image and re-encodes it so jsPDF / canvas can use it
// whatever it started as (WEBP, SVG, a transparent PNG, …). Resolves
// { dataUrl, format, width, height } or null when it can't be fetched or
// decoded (offline, CORS, an expired link) — callers then skip the image.
//   png  → keeps transparency (logos)
//   jpeg → smaller (photos), flattened onto white
export const imageUrlToDataUrl = async (url, { maxDim = 1200, format = 'jpeg', quality = 0.82 } = {}) => {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const image = await blobToImage(await response.blob());
    const sourceW = image.naturalWidth || image.width;
    const sourceH = image.naturalHeight || image.height;
    if (!sourceW || !sourceH) return null;

    const ratio = Math.min(1, maxDim / Math.max(sourceW, sourceH));
    const width = Math.max(1, Math.round(sourceW * ratio));
    const height = Math.max(1, Math.round(sourceH * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(image, 0, 0, width, height);
    return {
      dataUrl: canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', quality),
      format: format === 'jpeg' ? 'JPEG' : 'PNG',
      width,
      height
    };
  } catch (err) {
    console.warn('Could not prepare an image for the document:', err);
    return null;
  }
};

// Everything a printout needs from the logo: a viewable URL for HTML <img>
// tags and a canvas-safe copy for PDFs / the QR centre. Never throws.
export const loadLogoAsset = async (raw) => {
  const url = await resolveLogoUrl(raw);
  if (!url) return { url: '', image: null };
  const image = await imageUrlToDataUrl(url, { maxDim: 480, format: 'png' });
  return { url, image };
};

// A QR code as a PNG data URL. With a logo it is stamped in the centre on a
// white tile; error-correction level H survives ~30% damage and the tile
// covers ~5% of the area, so the code scans exactly as reliably.
export const makeQrDataUrl = async (text, { logo = null, size = 720, margin = 2 } = {}) => {
  const qr = await QRCode.toDataURL(text, { width: size, margin, errorCorrectionLevel: 'H' });
  if (!logo?.dataUrl) return qr;
  try {
    const [qrImage, logoImage] = await Promise.all([loadImageElement(qr), loadImageElement(logo.dataUrl)]);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return qr;
    ctx.drawImage(qrImage, 0, 0, size, size);

    const tile = Math.round(size * 0.22);
    const tileX = Math.round((size - tile) / 2);
    const pad = Math.round(tile * 0.1);
    ctx.fillStyle = '#ffffff';
    const radius = Math.round(tile * 0.18);
    ctx.beginPath();
    ctx.moveTo(tileX + radius, tileX);
    ctx.arcTo(tileX + tile, tileX, tileX + tile, tileX + tile, radius);
    ctx.arcTo(tileX + tile, tileX + tile, tileX, tileX + tile, radius);
    ctx.arcTo(tileX, tileX + tile, tileX, tileX, radius);
    ctx.arcTo(tileX, tileX, tileX + tile, tileX, radius);
    ctx.closePath();
    ctx.fill();

    const inner = tile - pad * 2;
    const fit = Math.min(inner / logoImage.width, inner / logoImage.height);
    const drawW = logoImage.width * fit;
    const drawH = logoImage.height * fit;
    ctx.drawImage(logoImage, tileX + pad + (inner - drawW) / 2, tileX + pad + (inner - drawH) / 2, drawW, drawH);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('Could not stamp the logo onto the QR code:', err);
    return qr;
  }
};

// Fits an image of (width × height) inside a (maxW × maxH) box, keeping its
// aspect ratio. Used to size logos / photos in millimetres on a PDF page.
export const fitWithin = (width, height, maxW, maxH) => {
  const aspect = width && height ? width / height : 1;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { width: w, height: h };
};
