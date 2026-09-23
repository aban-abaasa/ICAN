// Brands an imported .pptx pitch deck with the business's name and the
// IcanEra wordmark -- the slide-deck counterpart to videoWatermark.js's
// drawIcanEraWatermark, which does the same thing for recorded video. A
// .pptx is just a zip of XML files (OOXML): this unzips it with JSZip,
// injects a small two-tone text box ("<business> · via IcanEra", matching
// the same muted-gray/brand-green two-tone treatment
// PublicCompanyNoticeBoard.jsx's IcanEraWordmark already uses) onto the
// bottom-right of every slide, and re-zips it -- the branding is really
// baked into the file, not just an overlay in our own viewer.
//
// Same fail-safe philosophy as applyWatermarkToVideoBlob: if the file isn't
// a real/parseable .pptx, or anything else goes wrong, this returns the
// original file untouched (with a console warning) rather than blocking the
// import -- a business that already has a deck shouldn't be locked out by a
// branding bug.

import JSZip from 'jszip';

const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

// nb-wordmark-a / nb-wordmark-b in PublicCompanyNoticeBoard.jsx's NB_STYLES.
const WORDMARK_GRAY = '8A9A90';
const WORDMARK_GREEN = '166534';

const parseXml = (xmlString) => {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Could not parse slide XML');
  }
  return doc;
};

/** One slide's brand text box, sized/positioned from the deck's real slide
 * dimensions (EMU) so it sits bottom-right regardless of 4:3 vs 16:9. */
const buildBrandShapeXml = (businessName, slideWidthEmu, slideHeightEmu, shapeId) => {
  const margin = Math.round(slideWidthEmu * 0.02);
  const extCx = Math.round(slideWidthEmu * 0.32);
  const extCy = Math.round(slideHeightEmu * 0.05);
  const offX = slideWidthEmu - extCx - margin;
  const offY = slideHeightEmu - extCy - margin;
  const safeName = String(businessName || 'This business')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<p:sp xmlns:p="${P_NS}" xmlns:a="${A_NS}">
    <p:nvSpPr>
      <p:cNvPr id="${shapeId}" name="IcanEraBrand${shapeId}"/>
      <p:cNvSpPr txBox="1"/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${offX}" y="${offY}"/><a:ext cx="${extCx}" cy="${extCy}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="none" anchor="b" anchorCtr="0"><a:noAutofit/></a:bodyPr>
      <a:lstStyle/>
      <a:p>
        <a:pPr algn="r"/>
        <a:r>
          <a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="${WORDMARK_GRAY}"/></a:solidFill></a:rPr>
          <a:t>${safeName} &#183; via Ican</a:t>
        </a:r>
        <a:r>
          <a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="${WORDMARK_GREEN}"/></a:solidFill></a:rPr>
          <a:t>Era</a:t>
        </a:r>
      </a:p>
    </p:txBody>
  </p:sp>`;
};

/**
 * Brands every slide of an uploaded .pptx with "<businessName> · via
 * IcanEra". Returns a Promise<Blob> -- the branded deck, or `file` itself
 * unchanged if branding isn't possible for any reason.
 */
export const brandPitchDeck = async (file, { businessName }) => {
  try {
    const zip = await JSZip.loadAsync(file);

    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml) throw new Error('Not a valid .pptx (missing ppt/presentation.xml)');
    const presentationDoc = parseXml(presentationXml);
    const sldSz = presentationDoc.getElementsByTagNameNS(P_NS, 'sldSz')[0];
    const slideWidthEmu = parseInt(sldSz?.getAttribute('cx'), 10) || 12192000; // widescreen default
    const slideHeightEmu = parseInt(sldSz?.getAttribute('cy'), 10) || 6858000;

    const slideFiles = Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
    if (slideFiles.length === 0) throw new Error('No slides found in this .pptx');

    await Promise.all(slideFiles.map(async (path, index) => {
      const slideXml = await zip.file(path).async('string');
      const slideDoc = parseXml(slideXml);
      const spTree = slideDoc.getElementsByTagNameNS(P_NS, 'spTree')[0];
      if (!spTree) return; // unexpected slide structure -- leave this one slide untouched

      const shapeDoc = parseXml(buildBrandShapeXml(businessName, slideWidthEmu, slideHeightEmu, 900001 + index));
      const importedShape = slideDoc.importNode(shapeDoc.documentElement, true);
      spTree.appendChild(importedShape);

      const serialized = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${new XMLSerializer().serializeToString(slideDoc)}`;
      zip.file(path, serialized);
    }));

    return await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
  } catch (error) {
    console.warn('Could not brand pitch deck, uploading it unbranded:', error?.message || error);
    return file;
  }
};
