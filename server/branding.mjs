// Brand compositing for generated images: logo/watermark overlay + optional footer band.
// Pure image processing (no database access) so it is easy to unit test.
import sharp from "sharp";

const POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right", "center"]);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function color(value, fallback) {
  const text = String(value || "").trim();
  return HEX.test(text) ? text : fallback;
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[ch]));
}

/**
 * Normalise the optional branding keys of a profile's visual_identity_json.
 *   branding        false disables compositing entirely
 *   logoPosition    top-left | top-right | bottom-left | bottom-right | center  (default bottom-right)
 *   logoScale       logo width as a fraction of image width, 0.05-0.4          (default 0.16)
 *   footerText      text rendered in a band at the bottom (e.g. "@futuretech")
 *   bandColor       footer band colour (hex)                                   (default #0b1220)
 *   textColor       footer text colour (hex)                                   (default #ffffff)
 *   bandOpacity     0-1                                                        (default 0.72)
 */
export function resolveBrandingConfig(visualIdentity = {}) {
  const v = visualIdentity && typeof visualIdentity === "object" ? visualIdentity : {};
  return {
    enabled: v.branding !== false,
    logoPosition: POSITIONS.has(v.logoPosition) ? v.logoPosition : "bottom-right",
    logoScale: clamp(v.logoScale, 0.05, 0.4, 0.16),
    footerText: String(v.footerText || "").trim().slice(0, 80),
    bandColor: color(v.bandColor, "#0b1220"),
    textColor: color(v.textColor, "#ffffff"),
    bandOpacity: clamp(v.bandOpacity, 0, 1, 0.72)
  };
}

export function brandingWanted(config, hasLogo) {
  return Boolean(config.enabled && (hasLogo || config.footerText));
}

/**
 * Composite branding onto an image buffer and return a PNG buffer.
 * Never throws for bad logos: a logo that cannot be decoded is skipped so publishing is not blocked.
 */
export async function brandImage({ imageBuffer, logoBuffer = null, visualIdentity = {} }) {
  const config = resolveBrandingConfig(visualIdentity);
  if (!brandingWanted(config, Boolean(logoBuffer))) return { buffer: imageBuffer, branded: false, applied: [] };

  const base = sharp(imageBuffer).rotate();
  const meta = await base.metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const margin = Math.round(Math.min(width, height) * 0.04);
  const layers = [];
  const applied = [];
  let bandHeight = 0;

  if (config.footerText) {
    bandHeight = Math.max(36, Math.round(height * 0.07));
    const fontSize = Math.round(bandHeight * 0.5);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + bandHeight + '">' +
      '<rect width="100%" height="100%" fill="' + config.bandColor + '" fill-opacity="' + config.bandOpacity + '"/>' +
      '<text x="' + margin + '" y="' + Math.round(bandHeight * 0.68) + '" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="' + fontSize + '" font-weight="600" fill="' + config.textColor + '">' + escapeXml(config.footerText) + "</text></svg>"
    );
    layers.push({ input: svg, left: 0, top: height - bandHeight });
    applied.push("footer");
  }

  if (logoBuffer) {
    try {
      const logoWidth = Math.max(24, Math.round(width * config.logoScale));
      const logo = await sharp(logoBuffer).resize({ width: logoWidth, withoutEnlargement: false }).png().toBuffer();
      const logoMeta = await sharp(logo).metadata();
      const lw = logoMeta.width || logoWidth;
      const lh = logoMeta.height || logoWidth;
      const usableBottom = height - bandHeight;
      const positions = {
        "top-left": [margin, margin],
        "top-right": [width - lw - margin, margin],
        "bottom-left": [margin, usableBottom - lh - margin],
        "bottom-right": [width - lw - margin, usableBottom - lh - margin],
        center: [Math.round((width - lw) / 2), Math.round((usableBottom - lh) / 2)]
      };
      const [left, top] = positions[config.logoPosition];
      layers.push({ input: logo, left: Math.max(0, left), top: Math.max(0, top) });
      applied.push("logo");
    } catch {
      // Undecodable logo: skip it rather than failing the whole generation.
    }
  }

  if (!layers.length) return { buffer: imageBuffer, branded: false, applied: [] };
  const buffer = await base.composite(layers).png().toBuffer();
  return { buffer, branded: true, applied };
}
